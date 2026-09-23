import type { Item, Pick } from "./types";

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

/**
 * 編輯清單頁用。
 * href 這條同時扮演白名單：只有正規新聞稿的網址長這樣，影音（連 YouTube）、
 * 專題、圖輯都不符合而被跳過。用白名單而非黑名單，日後頁面夾帶新型態連結時
 * 預設行為是安全的。
 */
const RE_HREF = /href="\/news\/([a-z]+)\/(\d{12})\.aspx"/;
const RE_H2 = /<h2[^>]*>([\s\S]*?)<\/h2>/;
const RE_DATETIME = /datetime="([^"]+)"/;

/**
 * 清理 RSS／HTML 欄位內容：
 *  - 剝掉 <![CDATA[ ... ]]> 外殼
 *  - 移除殘留的 HTML 標籤（清單頁的標題包在 <span> 裡，靠這步剝掉）
 *  - 還原常見的 XML 實體字元（&amp; 要放最後，否則會二次還原出錯）
 */
export function clean(raw: string): string {
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

/** 從 guid 或連結取出 12 位文章 ID，這是與編輯清單頁對接的唯一鍵 */
export function extractAid(guid: string, link: string): string {
  return (guid.match(/(\d{12})$/) ?? link.match(/\/(\d{12})\.aspx/))?.[1] ?? "";
}

/**
 * 從 RSS 原始字串抽出前 max 則項目。
 * 刻意不使用完整 XML 解析器，以控制 CPU 消耗在 10 ms 以內。
 * 代價：遇到非標準格式可能抽取失敗。
 */
export function parseItems(xml: string, max: number): Item[] {
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
      aid: extractAid(guid, link),
      link,
      title,
      head: desc.match(RE_HEAD)?.[0] ?? "",
    });
  }

  return out;
}

/**
 * 從編輯清單頁的 HTML 抽出文章清單。三份清單共用這一份解析器。
 *
 * 先用 indexOf 把約 8 KB 的清單區段切出來再跑正則——整頁有 113～118 KB，
 * 直接對全文跑正則會有撞上 10 ms CPU 上限的風險。
 *
 * 回傳空陣列代表頁面結構可能已變更（找不到 jsMainList），呼叫端必須記錄，
 * 否則頻道會靜默停止更新而無人察覺。
 */
export function parseList(html: string): Pick[] {
  const start = html.indexOf('id="jsMainList"');
  if (start < 0) return [];
  const end = html.indexOf("</ul>", start);
  if (end < 0) return [];

  const out: Pick[] = [];
  // 以 <li> 切塊而非用一條長正則跨欄位比對：清單頁夾雜影音等異質項目時，
  // 切塊能保證標題與連結必定來自同一個 <li>，不會張冠李戴。
  for (const li of html.slice(start, end).split("<li>").slice(1)) {
    const href = li.match(RE_HREF);
    if (!href) continue; // 白名單：非正規新聞稿一律跳過

    const title = clean(li.match(RE_H2)?.[1] ?? "");
    if (!title) continue;

    const dt = li.match(RE_DATETIME)?.[1];
    const pubAt = dt ? Date.parse(dt) : NaN;

    out.push({
      aid: href[2],
      slug: href[1],
      title,
      url: `https://www.cna.com.tw/news/${href[1]}/${href[2]}.aspx`,
      pubAt: Number.isNaN(pubAt) ? null : pubAt,
    });
  }

  return out;
}
