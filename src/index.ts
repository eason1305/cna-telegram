/**
 * 中央社新聞 → Telegram 頻道（非官方）
 *
 * 推播對象不是全部新聞，而是中央社編輯部自己挑進版面的三份清單：
 * 聚焦、新聞圖表、特派看世界。程式不判斷新聞價值，只做同步。
 * 這是刻意的取捨——自行用關鍵字評分試過，中文沒有詞界會把「陸軍演練」誤判成「軍演」，
 * 也讀不出「對台灣無直接影響」的否定語意，不如直接沿用中央社的編輯判斷。
 *
 * 設計重點（對應 Cloudflare Workers Free 方案的限制）：
 *  1. 免費方案每次 Cron 觸發只有 10 ms CPU time，所以解析與推播拆成不同工作：
 *     scan() 解析 RSS、discover() 解析清單頁，兩者都不推播；drain() 只查 D1 與送訊息。
 *  2. 用正則抽取而非完整 XML／HTML 解析器，省 CPU、也省 bundle 體積（免費上限 3 MB）。
 *  3. 等待網路與 sleep 不計入 CPU time，所以節流可以放心慢慢送。
 *  4. 免費方案每次觸發最多 50 個 subrequest，**D1 查詢也算**，所以 MAX_SEND 設 12。
 *  5. 去重靠 D1 的 INSERT OR IGNORE 一次解決（原子操作）。
 *  6. 推播的並行安全則靠「全系統只有一條 Cron 會 drain」——撈 pending 再標記是
 *     先查再寫，不是原子的，同時跑兩個實例就會重複推播。詳見 CRON_JOBS。
 *
 * 訊息構成（為什麼長這樣）：
 *  本文只放「分類 emoji + 超連結標題 + 發稿訊頭 + 出處」，前言交給 Telegram 的
 *  連結預覽卡片。中央社的 og:description 就是 RSS <description> 去掉訊頭，兩邊都放
 *  等於同一段話讀者要看兩次；而卡片同時帶回首圖（og:image 多為真實文章照片），
 *  這也是 RSS 授權明列可用的「首圖連結」。
 *
 * 內容來源的界線：
 *  清單頁只用來決定「推哪幾則」，訊息本文的文字一律取自 RSS feed，
 *  任何情況下都不抓文章內頁。特稿系列不進 RSS、查不到訊頭時就少一行，不另尋來源。
 *
 * 授權注意：只推送標題、前言、首圖與原文連結，保留中央社發稿訊頭，標註「中央通訊社」。
 * 中央社 RSS 使用規範限定個人／非營利非商業用途，且禁止引用全文。
 * 不做 Telegram Instant View：那會讓全文在 Telegram 內重新上架，正是條款排除的那一項。
 */

import { parseItems, parseList } from "./parse";
import type { Env, Outgoing } from "./types";

export type { Env } from "./types";

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/**
 * 一個 RSS 分類。
 * emoji 只用於訊息開頭的視覺標記，不影響任何邏輯。
 * urlSlug 是中央社網址裡的分類代碼，編輯清單頁只給網址不給分類名稱，
 * 要靠它還原成分類與 emoji——放在同一個元組裡才不會跟上面兩欄各自漂移。
 */
type Feed = [
  category: string,
  slug: string,
  emoji: string,
  urlSlug: string,
];

type SourceKey = "headlines" | "chart" | "world";

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/**
 * 中央社 RSS 分類。這 11 個是官方 /about/rss.aspx 提供的全部 feed，
 * 沒有「聚焦」之類的編輯清單 feed，所以那三份清單只能從網頁取得。
 *
 * 掃描這些 feed 的唯一目的是建立「文章 ID → 發稿訊頭」查找表，本身不推播任何東西。
 * urlSlug 對應關係由 208 筆 RSS 實際資料反推，11 對 11 一對一。
 */
const FEEDS: Feed[] = [
  ["政治", "politics", "🏛️", "aipl"],
  ["國際", "intworld", "🌏", "aopl"],
  ["兩岸", "mainland", "🌊", "acn"], // 海峽的地理意象。刻意不用國旗，那會變成政治表態
  ["產經", "finance", "📈", "afe"],
  ["科技", "technology", "💻", "ait"],
  ["生活", "lifehealth", "🌿", "ahel"],
  ["社會", "social", "🚨", "asoc"],
  ["地方", "local", "📍", "aloc"],
  ["文化", "culture", "🎨", "acul"],
  ["運動", "sport", "🏅", "aspt"], // 用獎牌而非單一球類，才涵蓋得住綜合賽事
  ["娛樂", "stars", "🎬", "amov"],
];

/** urlSlug → Feed。由 FEEDS 直接導出，確保只有一份真相 */
const BY_URL_SLUG = new Map(FEEDS.map((f) => [f[3], f]));

/**
 * 三份編輯清單。三者的 HTML 結構完全相同，所以這裡只是資料，不是三份程式碼。
 * tag 會加在訊息結尾：圖表稿與特稿跟文字稿是各自獨立的文章、各有各的 ID，
 * 去重擋不住「同事件不同文章」，標記能讓它讀起來是補充版本而不是系統推了兩次。
 */
const SOURCES: Record<SourceKey, { url: string; tag: string }> = {
  headlines: { url: "https://www.cna.com.tw/list/headlines.aspx", tag: "" },
  chart: {
    url: "https://www.cna.com.tw/topic/newstopic/4479.aspx",
    tag: "📊 新聞圖表",
  },
  world: {
    url: "https://www.cna.com.tw/topic/newstopic/4215.aspx",
    tag: "🌍 特派看世界",
  },
};

/** 每輪最多解析幾則 item。調高會增加 CPU 消耗，有撞到 Error 1102 的風險 */
const MAX_ITEMS = 15;

/**
 * 每輪最多推播幾則。
 *
 * 免費方案每次 invocation 上限 50 個 subrequest，而**D1 的每次查詢也算 subrequest**
 * （官方文件：「A subrequest is any request a Worker makes using the Fetch API or to
 * Cloudflare services like R2, KV, or D1」，D1 limits 頁的「Queries per Worker
 * invocation」也直接標注 read subrequest limits = Free 50）。只算 Telegram 呼叫會嚴重低估。
 *
 * 每 5 分鐘那條同時做 discover + drain，是預算最緊的一次 invocation。D1 文件沒寫清楚
 * batch 裡的每個 statement 算一次還是整批算一次，所以用悲觀假設抓：
 *
 *   清單頁 fetch                        1
 *   INSERT OR IGNORE × 20 則（batch）   20   （樂觀假設：1）
 *   pending SELECT                      1
 *   每則 sendMessage + UPDATE × 12     24
 *   ────────────────────────────────────
 *   合計                               46   （樂觀假設：27）
 *
 * 悲觀下仍留 4 個給 429 重試。吞吐量綽綽有餘：聚焦約 40 則／天，而 drain 每天跑
 * 288 次 × 12 = 3,456 則／天的容量。
 */
const MAX_SEND = 12;

/** 每則之間的間隔（毫秒）。Telegram 頻道大約每分鐘只接受 20 則訊息 */
const GAP_MS = 3200;

/**
 * 單次 drain 的牆鐘上限。
 * 必須遠小於 drain 那條 Cron 的間隔（300 秒），否則某輪被 429 退避拖太久時，
 * 下一輪會在它還沒跑完時啟動——兩個實例撈到同一批 pending 就會重複推播。
 * 正常情況是 12 × 3.2 秒 ≈ 38 秒，這條保險平時不會生效。
 */
const MAX_DRAIN_MS = 200_000;

/** 查不到訊頭時，最多等多久讓 RSS 掃描補上（每個分類 11 分鐘會輪到一次） */
const WAIT_MS = 30 * 60_000;

/**
 * 流水號 >= 此值者為特稿／專欄系列，永遠不會出現在即時新聞 RSS 裡。
 * 實證：連續兩天每分鐘掃描累積 505 篇 RSS 文章，3xxx 系列 0 篇。
 * 這條界線讓特稿不必白等 WAIT_MS——否則每週只跑一次的特派會被延後整整一週。
 */
const FEATURE_SEQ = 3000;

const UA = "cna-unofficial-telegram/1.0";

// ---------------------------------------------------------------------------
// 工具函式
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 轉義成 Telegram HTML parse_mode 可以安全接受的文字 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 文章 ID 末 4 碼是當日流水號，用來分辨即時新聞（0xxx）與特稿（3xxx 以上） */
const isFeature = (aid: string): boolean =>
  Number(aid.slice(-4)) >= FEATURE_SEQ;

// ---------------------------------------------------------------------------
// Telegram 推播
// ---------------------------------------------------------------------------

/**
 * 送出一則訊息。遇到 429（速率限制）會依 Telegram 指示的秒數退避後重試，最多兩次。
 *
 * head 可能是空字串：特稿系列不進 RSS，永遠抽不到訊頭。這種情況只是少一行，
 * 預覽卡片仍會從 og tag 帶回摘要與首圖，訊息依然完整可讀。
 */
async function sendMessage(env: Env, msg: Outgoing, depth = 0): Promise<void> {
  // emoji 放在 <a> 外面：它不是中央社標題的一部分，包進去會被染成連結色，
  // 也會讓「哪幾個字是標題」變模糊。
  // href 一定要 escape——clean() 會把 &amp; 還原成裸 &，真的出現在網址裡會讓
  // Telegram 的 HTML 解析爛掉。目前中央社的 link 都沒有 query string，但這是零成本的保險。
  // 結尾的「中央通訊社」不能省：授權條款要求以文字標示，訊頭寫的是「中央社」不算數。
  const text =
    `${msg.emoji} <a href="${escapeHtml(msg.link)}"><b>${escapeHtml(msg.title)}</b></a>\n` +
    (msg.head ? `${escapeHtml(msg.head)}\n` : "") +
    `—— 中央通訊社 · ${msg.category}${msg.tag ? ` · ${msg.tag}` : ""}`;

  const res = await fetch(
    `https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TG_CHAT,
        text,
        parse_mode: "HTML",
        // 顯式指定 url，不依賴「訊息文字裡的第一個網址」那套 fallback。
        // 預覽卡片負責呈現首圖與前言，這兩樣都是 RSS 授權明列可用的項目，
        // 而且是 Telegram 直接讀中央社自己的 og tag，不經過我們轉手。
        link_preview_options: {
          url: msg.link,
          prefer_large_media: true,
        },
      }),
    },
  );

  if (res.status === 429 && depth < 2) {
    const body = (await res.json()) as {
      parameters?: { retry_after?: number };
    };
    const wait = (body.parameters?.retry_after ?? 5) + 1;
    console.log(`429 rate limited, retry after ${wait}s`);
    await sleep(wait * 1000);
    return sendMessage(env, msg, depth + 1);
  }

  if (!res.ok) {
    throw new Error(`telegram ${res.status}: ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// 掃描：建立「文章 ID → 發稿訊頭」查找表
// ---------------------------------------------------------------------------

/**
 * 每分鐘輪詢一個 RSS 分類，把看到的新聞全部寫進 seen。**不推播任何東西。**
 *
 * 這是整套機制的前置作業：RSS feed 只保留 4～5 小時（實測國際／產經／生活為
 * 4.1～4.5 小時），而編輯清單每天／每週才檢查一次，推播當下再去抓 feed 一定來不及。
 * 所以訊頭必須在這裡就落地保存。
 */
async function scan(env: Env): Promise<string> {
  // 依「當前分鐘數」輪詢分類，讓每個分類平均被掃到（11 分類 → 每 11 分鐘一輪）
  const index = Math.floor(Date.now() / 60_000) % FEEDS.length;
  const [category, slug] = FEEDS[index];

  const res = await fetch(`https://feeds.feedburner.com/rsscna/${slug}`, {
    headers: { "user-agent": UA },
  });

  if (!res.ok) {
    console.error(`feed ${slug} returned ${res.status}`);
    return `${category}: feed error ${res.status}`;
  }

  const items = parseItems(await res.text(), MAX_ITEMS);
  if (!items.length) {
    console.error(`feed ${slug}: parsed 0 items`);
    return `${category}: parsed 0`;
  }

  // 用 batch 一次送出，省下十幾次來回。INSERT OR IGNORE 的原子去重不受影響。
  const now = Date.now();
  const stmt = env.DB.prepare(
    "INSERT OR IGNORE INTO seen (guid, aid, cat, title, link, head, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const results = await env.DB.batch(
    items.map((i) =>
      stmt.bind(i.guid, i.aid, category, i.title, i.link, i.head, now),
    ),
  );
  const added = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);

  const msg = `${category}: parsed ${items.length}, new ${added}`;
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
// 推播：依編輯清單決定推哪幾則
// ---------------------------------------------------------------------------

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
async function discover(env: Env, key: SourceKey): Promise<string> {
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
  const added = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);

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
async function drain(env: Env): Promise<string> {
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
        emoji: feed?.[2] ?? "📰",
        // 標題優先用 RSS 的版本（與 feed 一致），查不到才用清單頁上的
        title: row.rss_title || row.title,
        link: row.url,
        head,
        category: feed?.[0] ?? "新聞",
        tag: SOURCES[row.source as SourceKey]?.tag ?? "",
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

// ---------------------------------------------------------------------------
// Worker 入口
// ---------------------------------------------------------------------------

/**
 * Cron 排程字串 → 這一輪要抓哪份清單、要不要順便推播。
 * 字串必須與 wrangler.jsonc 的 crons 完全一致。
 * 沒對應到的（也就是每分鐘那條）一律跑 scan。
 *
 * **drain 只有一條，這是刻意的，不要再加第二條。**
 * 週日 UTC 00:00 這三條會同時觸發（0 可被 5 整除），如果每條都會推播，
 * 三個實例會各自撈到同一批 pending，同一則就被送三次。
 * 讓同時只存在一個 drainer 是最省的解法：不需要鎖、不需要租約欄位，
 * 也不必依賴「把分鐘數錯開」這種一加新 Cron 就會破功的算術。
 *
 * 圖表與特派不會因此變慢：drain 的查詢不依 source 過濾，
 * 它們在 00:00 被記錄下來後，最多 5 分鐘就會被每 5 分鐘那條撿走。
 */
const CRON_JOBS: Record<string, { src: SourceKey; drain: boolean }> = {
  "*/5 * * * *": { src: "headlines", drain: true },
  "0 0 * * *": { src: "chart", drain: false }, // UTC 00:00 = 台北 08:00
  "0 0 * * SUN": { src: "world", drain: false }, // 每週日台北 08:00
};

/**
 * 每分鐘那條，對不到 CRON_JOBS 就是它。
 * 獨立成常數是為了讓「真的對不到任何一條」能被認出來並留下紀錄——
 * 否則排程字串打錯只會安靜地全部掉進 scan()，那份清單永遠不會被抓。
 */
const SCAN_CRON = "* * * * *";

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

export default {
  /** Cron 排程觸發 */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const job = CRON_JOBS[controller.cron];

    // 排程字串必須與 wrangler.jsonc 逐字一致。對不上的話這裡會靜默退回 scan()，
    // 那份清單就永遠不會被抓而且不會報錯——所以對不上就要留下紀錄。
    if (!job && controller.cron !== SCAN_CRON) {
      console.error(
        `unknown cron "${controller.cron}" — 與 CRON_JOBS 對不上，這次當成 scan 處理`,
      );
    }

    // waitUntil 讓節流的等待時間不會被提前中斷
    ctx.waitUntil(
      job
        ? (async () => {
            await discover(env, job.src);
            if (job.drain) await drain(env);
          })()
        : scan(env),
    );
  },

  /** HTTP 入口：手動觸發與健康檢查 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      return new Response(await scan(env), { headers: TEXT_HEADERS });
    }

    // 只抓清單頁記進 picked，不推播——推播一律走 /push，與 Cron 的分工一致
    if (url.pathname === "/pick") {
      const src = url.searchParams.get("src") ?? "headlines";
      if (!(src in SOURCES)) {
        return new Response(
          `unknown src: ${src}\n可用值: ${Object.keys(SOURCES).join(", ")}`,
          { status: 400, headers: TEXT_HEADERS },
        );
      }
      return new Response(await discover(env, src as SourceKey), {
        headers: TEXT_HEADERS,
      });
    }

    // 手動推播。注意：每 5 分鐘的 Cron 也會 drain，兩者同時跑就會重複推播，
    // 所以這個端點只適合在本機或確定 Cron 沒在跑的時候用。
    if (url.pathname === "/push") {
      return new Response(await drain(env), { headers: TEXT_HEADERS });
    }

    if (url.pathname === "/stats") {
      // stuck = 還沒推出去而且已經失敗三次以上的。因為不設放棄門檻，
      // 這種項目會一直留在隊尾重試，只能靠這個數字看見它們的存在。
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS tracked,
                SUM(CASE WHEN pushed_at IS NOT NULL THEN 1 ELSE 0 END) AS pushed,
                SUM(CASE WHEN pushed_at IS NULL AND tries >= 3 THEN 1 ELSE 0 END) AS stuck,
                MAX(pushed_at) AS latest
           FROM picked`,
      ).first<{
        tracked: number;
        pushed: number | null;
        stuck: number | null;
        latest: number | null;
      }>();
      const bySource = await env.DB.prepare(
        "SELECT source, COUNT(*) AS n FROM picked WHERE pushed_at IS NOT NULL GROUP BY source",
      ).all<{ source: string; n: number }>();

      return Response.json({
        tracked: row?.tracked ?? 0,
        pushed: row?.pushed ?? 0,
        stuck: row?.stuck ?? 0,
        latest: row?.latest ? new Date(row.latest).toISOString() : null,
        bySource: Object.fromEntries(
          bySource.results.map((r) => [r.source, r.n]),
        ),
      });
    }

    return new Response("alive", { headers: TEXT_HEADERS });
  },
};
