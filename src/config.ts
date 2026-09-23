/**
 * 一個 RSS 分類。
 * emoji 只用於訊息開頭的視覺標記，不影響任何邏輯。
 * urlSlug 是中央社網址裡的分類代碼，編輯清單頁只給網址不給分類名稱，
 * 要靠它還原成分類與 emoji——放在同一筆資料裡才不會跟上面兩欄各自漂移。
 */
export type Feed = {
  category: string;
  /** feedburner 上的 feed 名稱 */
  slug: string;
  emoji: string;
  urlSlug: string;
};

export type SourceKey = "headlines" | "chart" | "world";

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
export const FEEDS: Feed[] = [
  { category: "政治", slug: "politics", emoji: "🏛️", urlSlug: "aipl" },
  { category: "國際", slug: "intworld", emoji: "🌏", urlSlug: "aopl" },
  { category: "兩岸", slug: "mainland", emoji: "🌊", urlSlug: "acn" }, // 海峽的地理意象。刻意不用國旗，那會變成政治表態
  { category: "產經", slug: "finance", emoji: "📈", urlSlug: "afe" },
  { category: "科技", slug: "technology", emoji: "💻", urlSlug: "ait" },
  { category: "生活", slug: "lifehealth", emoji: "🌿", urlSlug: "ahel" },
  { category: "社會", slug: "social", emoji: "🚨", urlSlug: "asoc" },
  { category: "地方", slug: "local", emoji: "📍", urlSlug: "aloc" },
  { category: "文化", slug: "culture", emoji: "🎨", urlSlug: "acul" },
  { category: "運動", slug: "sport", emoji: "🏅", urlSlug: "aspt" }, // 用獎牌而非單一球類，才涵蓋得住綜合賽事
  { category: "娛樂", slug: "stars", emoji: "🎬", urlSlug: "amov" },
];

/** urlSlug → Feed。由 FEEDS 直接導出，確保只有一份真相 */
export const BY_URL_SLUG = new Map(FEEDS.map((f) => [f.urlSlug, f]));

/**
 * 三份編輯清單。三者的 HTML 結構完全相同，所以這裡只是資料，不是三份程式碼。
 * tag 會加在訊息結尾：圖表稿與特稿跟文字稿是各自獨立的文章、各有各的 ID，
 * 去重擋不住「同事件不同文章」，標記能讓它讀起來是補充版本而不是系統推了兩次。
 */
export const SOURCES: Record<SourceKey, { url: string; tag: string }> = {
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

/**
 * 外部字串（D1 欄位、網址參數）是否為合法的清單代碼。
 * 用 hasOwn 而非 in：後者會把 "toString" 這類原型屬性也當成清單。
 */
export const isSourceKey = (s: string): s is SourceKey =>
  Object.hasOwn(SOURCES, s);

/** 每輪最多解析幾則 item。調高會增加 CPU 消耗，有撞到 Error 1102 的風險 */
export const MAX_ITEMS = 15;

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
export const MAX_SEND = 12;

/** 每則之間的間隔（毫秒）。Telegram 頻道大約每分鐘只接受 20 則訊息 */
export const GAP_MS = 3200;

/**
 * 單次 drain 的牆鐘上限。
 * 必須遠小於 drain 那條 Cron 的間隔（300 秒），否則某輪被 429 退避拖太久時，
 * 下一輪會在它還沒跑完時啟動——兩個實例撈到同一批 pending 就會重複推播。
 * 正常情況是 12 × 3.2 秒 ≈ 38 秒，這條保險平時不會生效。
 */
export const MAX_DRAIN_MS = 200_000;

/** 查不到訊頭時，最多等多久讓 RSS 掃描補上（每個分類 11 分鐘會輪到一次） */
export const WAIT_MS = 30 * 60_000;

/**
 * 流水號 >= 此值者為特稿／專欄系列，永遠不會出現在即時新聞 RSS 裡。
 * 實證：連續兩天每分鐘掃描累積 505 篇 RSS 文章，3xxx 系列 0 篇。
 * 這條界線讓特稿不必白等 WAIT_MS——否則每週只跑一次的特派會被延後整整一週。
 */
export const FEATURE_SEQ = 3000;

export const UA = "cna-unofficial-telegram/1.0";

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
export const CRON_JOBS: Record<string, { src: SourceKey; drain: boolean }> = {
  "*/5 * * * *": { src: "headlines", drain: true },
  "0 0 * * *": { src: "chart", drain: false }, // UTC 00:00 = 台北 08:00
  "0 0 * * SUN": { src: "world", drain: false }, // 每週日台北 08:00
};

/**
 * 每分鐘那條，對不到 CRON_JOBS 就是它。
 * 獨立成常數是為了讓「真的對不到任何一條」能被認出來並留下紀錄——
 * 否則排程字串打錯只會安靜地全部掉進 scan()，那份清單永遠不會被抓。
 */
export const SCAN_CRON = "* * * * *";
