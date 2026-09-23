import { FEEDS, MAX_ITEMS, UA } from "./config";
import { parseItems } from "./parse";
import type { Env } from "./types";
import { sumChanges } from "./util";

// 掃描：建立「文章 ID → 發稿訊頭」查找表

/**
 * 每分鐘輪詢一個 RSS 分類，把看到的新聞全部寫進 seen。**不推播任何東西。**
 *
 * 這是整套機制的前置作業：RSS feed 只保留 4～5 小時（實測國際／產經／生活為
 * 4.1～4.5 小時），而編輯清單每天／每週才檢查一次，推播當下再去抓 feed 一定來不及。
 * 所以訊頭必須在這裡就落地保存。
 */
export async function scan(env: Env): Promise<string> {
  // 依「當前分鐘數」輪詢分類，讓每個分類平均被掃到（11 分類 → 每 11 分鐘一輪）
  const index = Math.floor(Date.now() / 60_000) % FEEDS.length;
  const { category, slug } = FEEDS[index];

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
  const added = sumChanges(results);

  const msg = `${category}: parsed ${items.length}, new ${added}`;
  console.log(msg);
  return msg;
}
