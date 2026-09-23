import {
  BY_URL_SLUG,
  GAP_MS,
  isSourceKey,
  MAX_DRAIN_MS,
  MAX_SEND,
  SOURCES,
  type SourceKey,
  UA,
  WAIT_MS,
} from "./config";
import { isFeature, parseList } from "./parse";
import { sendMessage } from "./telegram";
import type { Env } from "./types";
import { sleep, sumChanges } from "./util";

// 推播：依編輯清單決定推哪幾則

type PendingRow = {
  aid: string;
  source: string;
  slug: string;
  title: string;
  url: string;
  pub_at: number | null;
  rss_title: string | null;
  head: string | null;
};

/**
 * 抓一份編輯清單，把上面的文章記進 picked。**不送任何訊息。**
 *
 * 推播由 drain() 負責，而且全系統只有一個 Cron 會呼叫 drain()——
 * 理由見 CRON_JOBS 的註解。
 *
 * 去重完全靠 picked.aid 主鍵 + INSERT OR IGNORE，不使用任何時間窗：
 *  - 三份清單共用 picked 表，同一篇文章不論被哪份先看到都只會推一次
 *  - 某次執行失敗時漏掉的項目下次自動補上，不會永久遺失
 * 後者對每天／每週才跑一次的圖表與特派特別重要——用「過去 24 小時」這類條件的話，
 * 一次失敗就是永久漏稿。
 */
export async function discover(env: Env, key: SourceKey): Promise<string> {
  const src = SOURCES[key];

  const res = await fetch(src.url, { headers: { "user-agent": UA } });
  if (!res.ok) {
    console.error(`${key}: page returned ${res.status}`);
    return `${key}: page error ${res.status}`;
  }

  const picks = parseList(await res.text());
  if (!picks.length) {
    // 本方案最可能的長期故障模式：頁面改版後 jsMainList 消失，
    // 解析回傳 0 則卻不會拋錯，頻道就此安靜。必須留下痕跡才看得見。
    console.error(`${key}: parsed 0 items — 清單頁結構可能已變更`);
    return `${key}: parsed 0 (structure changed?)`;
  }

  const seedOnly = env.SEED_ONLY === "1";
  const now = Date.now();

  // 灌種模式直接把 pushed_at 填成現在，等於「記錄下來但視為已推」。
  // 首次上線時三份清單合計約 60 則（圖表橫跨 50 天、特派橫跨 88 天），
  // 少了這步會在上線瞬間全部推出。
  const ins = env.DB.prepare(
    "INSERT OR IGNORE INTO picked (aid, source, slug, title, url, pub_at, found_at, pushed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const results = await env.DB.batch(
    picks.map((p) =>
      ins.bind(
        p.aid,
        key,
        p.slug,
        p.title,
        p.url,
        p.pubAt,
        now,
        seedOnly ? now : null,
      ),
    ),
  );
  const added = sumChanges(results);

  const msg = `${key}: parsed ${picks.length}, new ${added}${seedOnly ? " (seed mode)" : ""}`;
  console.log(msg);
  return msg;
}

/**
 * 把 picked 裡還沒推播的項目送出去。**不碰任何 HTML／XML 解析。**
 *
 * 只有一條 Cron 會呼叫這個函式，這是並行安全的唯一依據：
 * 「撈 pending → 送出 → 標記 pushed_at」是先查再寫，兩個實例同時跑就會各自撈到
 * 同一批而重複推播（picked.aid 主鍵只擋得住重複「記錄」，擋不住重複「推播」）。
 * 與其用鎖或租約把每一則的認領變成原子操作，不如讓同時只存在一個 drainer。
 *
 * 查詢不依 source 過濾是刻意的：圖表與特派的項目也由這裡撿走，
 * 所以它們的失敗重試是 5 分鐘一次，而不是等下一次每天／每週的 Cron。
 */
export async function drain(env: Env): Promise<string> {
  // 灌種模式下所有列在寫入時就已標記為已推，這裡直接省下一次查詢
  if (env.SEED_ONLY === "1") return "drain: skipped (seed mode)";

  const startedAt = Date.now();

  // 排序第一順位是 tries：送失敗過的自動沉到隊尾，新聞永遠排在它前面。
  // 沒有這一欄的話，一則永遠送不出去的會卡在隊首把整條隊列堵死（見 002 migration）。
  // tries 相同時依 found_at；found_at 也相同（同一批）時再依 pub_at，
  // 讓同批的多則在頻道上維持發稿時序。
  const pending = await env.DB.prepare(
    `SELECT p.aid, p.source, p.slug, p.title, p.url, p.pub_at,
            s.title AS rss_title, s.head AS head
       FROM picked p
       LEFT JOIN seen s ON s.aid = p.aid
      WHERE p.pushed_at IS NULL
      ORDER BY p.tries, p.found_at, p.pub_at
      LIMIT ?`,
  )
    .bind(MAX_SEND)
    .all<PendingRow>();

  let sent = 0;
  let waiting = 0;

  for (const row of pending.results) {
    // 寧可少送幾則，也不要跑進下一輪的時間——重疊就是重複推播
    if (Date.now() - startedAt > MAX_DRAIN_MS) {
      console.error(`drain: hit ${MAX_DRAIN_MS}ms wall clock, stopping early`);
      break;
    }

    const head = row.head ?? "";

    // 查不到訊頭時要不要再等一輪？特稿不必等，它永遠不會進 RSS。
    // 即時新聞則可能只是剛發布、RSS 還沒輪到，值得等下一輪。
    if (!head && !isFeature(row.aid)) {
      const age = row.pub_at === null ? Infinity : startedAt - row.pub_at;
      if (age < WAIT_MS) {
        waiting++;
        continue;
      }
    }

    const feed = BY_URL_SLUG.get(row.slug);

    try {
      await sendMessage(env, {
        emoji: feed?.emoji ?? "📰",
        // 標題優先用 RSS 的版本（與 feed 一致），查不到才用清單頁上的
        title: row.rss_title || row.title,
        link: row.url,
        head,
        category: feed?.category ?? "新聞",
        tag: isSourceKey(row.source) ? SOURCES[row.source].tag : "",
      });
      // 送出成功才標記。失敗時 pushed_at 維持 NULL，下一輪自動重試，不會靜默漏稿。
      await env.DB.prepare("UPDATE picked SET pushed_at = ? WHERE aid = ?")
        .bind(Date.now(), row.aid)
        .run();
      sent++;
      await sleep(GAP_MS);
    } catch (err) {
      console.error(`send failed (aid ${row.aid}): ${String(err)}`);
      // 記一次失敗讓它沉到隊尾，然後仍然 break——失敗通常是系統性的
      // （token 失效、頻道權限），繼續送只會連錯。
      // 但因為排序看 tries，下一輪換別則排頭，不會像以前那樣卡死。
      //
      // 刻意不設「試 N 次就放棄」的門檻：系統性故障會讓每一則都累積 tries，
      // 有門檻的話一次兩小時的故障就等於把整批新聞永久丟掉。
      // 真的卡住的那幾則靠 /stats 的 stuck 計數看得見，人工處理。
      await env.DB.prepare("UPDATE picked SET tries = tries + 1 WHERE aid = ?")
        .bind(row.aid)
        .run();
      break;
    }
  }

  const msg = `drain: sent ${sent}${waiting ? `, waiting ${waiting}` : ""}`;
  console.log(msg);
  return msg;
}
