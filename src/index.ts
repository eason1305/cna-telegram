/**
 * 中央社新聞 → Telegram 頻道（非官方）
 *
 * 設計重點（對應 Cloudflare Workers Free 方案的限制）：
 *  1. 免費方案每次 Cron 觸發只有 10 ms CPU time，所以每輪只處理「一個」分類的 feed。
 *  2. 用正則抽取而非完整 XML 解析器，省 CPU、也省 bundle 體積（免費上限 3 MB）。
 *  3. 等待網路與 sleep 不計入 CPU time，所以節流可以放心慢慢送。
 *  4. 免費方案每次觸發最多 50 個「外部」subrequest，所以 MAX_SEND 設 20 留餘裕。
 *  5. 去重與並行安全都靠 D1 的 INSERT OR IGNORE 一次解決（原子操作）。
 *
 * 訊息構成（為什麼長這樣）：
 *  本文只放「分類 emoji + 超連結標題 + 發稿訊頭 + 出處」，前言交給 Telegram 的
 *  連結預覽卡片。中央社的 og:description 就是 RSS <description> 去掉訊頭，兩邊都放
 *  等於同一段話讀者要看兩次；而卡片同時帶回首圖（og:image 多為真實文章照片），
 *  這也是 RSS 授權明列可用的「首圖連結」。
 *
 * 授權注意：只推送標題、前言、首圖與原文連結，保留中央社發稿訊頭，標註「中央通訊社」。
 * 中央社 RSS 使用規範限定個人／非營利非商業用途，且禁止引用全文。
 * 不做 Telegram Instant View：那會讓全文在 Telegram 內重新上架，正是條款排除的那一項。
 */

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface Env {
  /** D1 資料庫綁定，名稱對應 wrangler.jsonc 裡的 binding */
  DB: D1Database;
  /** Telegram Bot Token（用 wrangler secret put 設定，不要寫在檔案裡） */
  TG_TOKEN: string;
  /** 目標頻道，公開頻道用 "@channel_name"，私人頻道用 "-100xxxxxxxxxx" */
  TG_CHAT: string;
  /** "1" = 只寫入去重資料庫、不實際推播（首次上線灌種用） */
  SEED_ONLY: string;
}

type Item = {
  guid: string;
  title: string;
  link: string;
  /** 中央社發稿訊頭，例：「（中央社記者李宗憲曼谷16日專電）」。抽不出來時為空字串 */
  head: string;
};

/** 一個 RSS 分類。emoji 只用於訊息開頭的視覺標記，不影響任何邏輯 */
type Feed = [category: string, slug: string, emoji: string];

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/**
 * 中央社 RSS 分類。
 * 不需要的分類請直接刪掉，清單越短，每個分類被輪到的間隔就越短。
 * 目前 11 個分類 + 每分鐘觸發 = 每個分類約 11 分鐘掃一次。
 */
const FEEDS: Feed[] = [
  ["政治", "politics", "🏛️"],
  ["國際", "intworld", "🌏"],
  ["兩岸", "mainland", "🌊"], // 海峽的地理意象。刻意不用國旗，那會變成政治表態
  ["產經", "finance", "📈"],
  ["科技", "technology", "💻"],
  ["生活", "lifehealth", "🌿"],
  ["社會", "social", "🚨"],
  ["地方", "local", "📍"],
  ["文化", "culture", "🎨"],
  ["運動", "sport", "🏅"], // 用獎牌而非單一球類，才涵蓋得住綜合賽事
  ["娛樂", "stars", "🎬"],
];

/** 每輪最多解析幾則 item。調高會增加 CPU 消耗，有撞到 Error 1102 的風險 */
const MAX_ITEMS = 15;

/** 每輪最多推播幾則。免費方案外部 subrequest 上限 50，這裡留足夠餘裕給重試 */
const MAX_SEND = 20;

/** 每則之間的間隔（毫秒）。Telegram 頻道大約每分鐘只接受 20 則訊息 */
const GAP_MS = 3200;

// ---------------------------------------------------------------------------
// 工具函式
// ---------------------------------------------------------------------------

/** 預先編譯的正則。放在模組層級，避免每次呼叫都重新建立（省 CPU） */
const RE_ITEM = /<item[\s>][\s\S]*?<\/item>/g;
const RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/;
const RE_LINK = /<link[^>]*>([\s\S]*?)<\/link>/;
const RE_GUID = /<guid[^>]*>([\s\S]*?)<\/guid>/;
const RE_DESC = /<description[^>]*>([\s\S]*?)<\/description>/;

/**
 * 中央社發稿訊頭。涵蓋「（中央社記者OOO台北16日電）」「（中央社倫敦16日綜合外電報導）」
 * 等各種變體——共通點是以「（中央社」開頭、到第一個全形右括號為止。
 * 實測 5 個分類共 100 則，100% 抽得出來。
 */
const RE_HEAD = /^（中央社[^）]*）/;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 轉義成 Telegram HTML parse_mode 可以安全接受的文字 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 清理 RSS 欄位內容：
 *  - 剝掉 <![CDATA[ ... ]]> 外殼
 *  - 移除殘留的 HTML 標籤
 *  - 還原常見的 XML 實體字元（&amp; 要放最後，否則會二次還原出錯）
 */
function clean(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 從 RSS 原始字串抽出前 max 則項目。
 * 刻意不使用完整 XML 解析器，以控制 CPU 消耗在 10 ms 以內。
 * 代價：遇到非標準格式可能抽取失敗。
 */
function parseItems(xml: string, max: number): Item[] {
  const out: Item[] = [];
  RE_ITEM.lastIndex = 0; // 全域正則會記住上次位置，每次用前必須歸零

  let match: RegExpExecArray | null;
  while (out.length < max && (match = RE_ITEM.exec(xml)) !== null) {
    const block = match[0];

    const link = clean(block.match(RE_LINK)?.[1] ?? "");
    // 優先用 <guid>，沒有的話退回用連結當識別碼
    const guid = clean(block.match(RE_GUID)?.[1] ?? "") || link;
    if (!guid) continue;

    const title = clean(block.match(RE_TITLE)?.[1] ?? "");
    if (!title) continue;

    // 只取訊頭，其餘前言不進訊息本文——Telegram 的連結預覽會從中央社自己的
    // og:description 顯示同一段前言，兩邊都放等於同一段話讀者要看兩次。
    // 而訊頭是預覽永遠不會顯示的（中央社產 og:description 時就把它砍掉了），
    // 所以留訊頭是補上預覽缺的那塊，不是重複。
    const desc = clean(block.match(RE_DESC)?.[1] ?? "");

    out.push({
      guid,
      link,
      title,
      head: desc.match(RE_HEAD)?.[0] ?? "",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Telegram 推播
// ---------------------------------------------------------------------------

/**
 * 送出一則訊息。遇到 429（速率限制）會依 Telegram 指示的秒數退避後重試，最多兩次。
 */
async function sendMessage(
  env: Env,
  category: string,
  emoji: string,
  item: Item,
  depth = 0,
): Promise<void> {
  // emoji 放在 <a> 外面：它不是中央社標題的一部分，包進去會被染成連結色，
  // 也會讓「哪幾個字是標題」變模糊。
  // href 一定要 escape——clean() 會把 &amp; 還原成裸 &，真的出現在網址裡會讓
  // Telegram 的 HTML 解析爛掉。目前中央社的 link 都沒有 query string，但這是零成本的保險。
  // 結尾的「中央通訊社」不能省：授權條款要求以文字標示，訊頭寫的是「中央社」不算數。
  const text =
    `${emoji} <a href="${escapeHtml(item.link)}"><b>${escapeHtml(item.title)}</b></a>\n` +
    (item.head ? `${escapeHtml(item.head)}\n` : "") +
    `—— 中央通訊社 · ${category}`;

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
          url: item.link,
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
    return sendMessage(env, category, emoji, item, depth + 1);
  }

  if (!res.ok) {
    throw new Error(`telegram ${res.status}: ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function run(env: Env): Promise<string> {
  // 依「當前分鐘數」輪詢分類，讓每個分類平均被掃到
  const index = Math.floor(Date.now() / 60_000) % FEEDS.length;
  const [category, slug, emoji] = FEEDS[index];

  const feedUrl = `https://feeds.feedburner.com/rsscna/${slug}`;
  const res = await fetch(feedUrl, {
    headers: { "user-agent": "cna-unofficial-telegram/1.0" },
  });

  if (!res.ok) {
    console.error(`feed ${slug} returned ${res.status}`);
    return `${category}: feed error ${res.status}`;
  }

  const items = parseItems(await res.text(), MAX_ITEMS).reverse(); // 舊 → 新，時序才對
  const seedOnly = env.SEED_ONLY === "1";
  let sent = 0;

  for (const item of items) {
    // 原子去重：不存在才寫入。changes === 0 表示這則已經處理過
    const insert = await env.DB.prepare(
      "INSERT OR IGNORE INTO seen (guid, cat, title, ts) VALUES (?, ?, ?, ?)",
    )
      .bind(item.guid, category, item.title, Date.now())
      .run();

    if (!insert.meta.changes) continue; // 推播過了
    if (seedOnly) continue; // 灌種模式：只記錄不推播
    if (sent >= MAX_SEND) break; // 保護 subrequest 額度

    try {
      await sendMessage(env, category, emoji, item);
      sent++;
      await sleep(GAP_MS);
    } catch (err) {
      // 送失敗就把去重紀錄收回，下一輪會重試，避免靜默漏稿
      await env.DB.prepare("DELETE FROM seen WHERE guid = ?")
        .bind(item.guid)
        .run();
      console.error(`send failed: ${String(err)}`);
      break; // 通常是 token 或頻道權限問題，繼續送只會連錯
    }
  }

  const msg = `${category}: parsed ${items.length}, sent ${sent}${seedOnly ? " (seed mode)" : ""}`;
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
// Worker 入口
// ---------------------------------------------------------------------------

export default {
  /** Cron 排程觸發 */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // waitUntil 讓節流的等待時間不會被提前中斷
    ctx.waitUntil(run(env));
  },

  /** HTTP 入口：手動觸發與健康檢查 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      const result = await run(env);
      return new Response(result, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/stats") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n, MAX(ts) AS latest FROM seen",
      ).first<{ n: number; latest: number | null }>();
      return Response.json({
        total: row?.n ?? 0,
        latest: row?.latest ? new Date(row.latest).toISOString() : null,
        categories: FEEDS.length,
      });
    }

    return new Response("alive", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
