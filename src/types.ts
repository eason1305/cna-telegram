export interface Env {
  /** D1 資料庫綁定，名稱對應 wrangler.jsonc 裡的 binding */
  DB: D1Database;
  /** Telegram Bot Token（用 wrangler secret put 設定，不要寫在檔案裡） */
  TG_TOKEN: string;
  /** 目標頻道，公開頻道用 "@channel_name"，私人頻道用 "-100xxxxxxxxxx" */
  TG_CHAT: string;
  /** "1" = 只寫入資料庫、不實際推播（首次上線灌種用） */
  SEED_ONLY: string;
}

export type Item = {
  guid: string;
  /** 12 位文章 ID，與編輯清單頁對接的唯一鍵 */
  aid: string;
  title: string;
  link: string;
  /** 中央社發稿訊頭，例：「（中央社記者李宗憲曼谷16日專電）」。抽不出來時為空字串 */
  head: string;
};

/** 編輯清單頁上的一則新聞 */
export type Pick = {
  aid: string;
  /** 網址裡的分類代碼 aipl / aopl / acn … */
  slug: string;
  title: string;
  url: string;
  pubAt: number | null;
};

/** 準備送往 Telegram 的一則訊息 */
export type Outgoing = {
  emoji: string;
  title: string;
  link: string;
  head: string;
  category: string;
  /** 來源標記，例「📊 新聞圖表」。聚焦為空字串 */
  tag: string;
};
