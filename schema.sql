-- 去重紀錄表
--
-- guid 設為 PRIMARY KEY 是整個去重機制的核心：
-- SQLite 保證主鍵唯一，所以 INSERT OR IGNORE 成為一個「原子」操作，
-- 即使兩個 Worker 實例同時插入同一個 guid，也只有一個會成功。
-- 這同時解決了「重複推播」與「競態條件」兩個問題。

CREATE TABLE IF NOT EXISTS seen (
  guid  TEXT    PRIMARY KEY,   -- RSS 的 <guid>，中央社用文章網址；稿件更新時不變
  cat   TEXT    NOT NULL,      -- 分類名稱，方便日後查詢統計
  title TEXT,                  -- 標題，純粹方便你事後排查用
  ts    INTEGER NOT NULL       -- 寫入時間（Unix 毫秒）
);

-- 依時間查詢用的索引。
-- 沒有索引的話，任何依 ts 篩選的查詢都會全表掃描，
-- 而 D1 的免費額度是按「掃描了幾列」計算的，全表掃描會快速吃光額度。
CREATE INDEX IF NOT EXISTS seen_ts ON seen (ts);

-- 依分類查詢用的索引（如果你之後想做「某分類最近推了什麼」的統計）
CREATE INDEX IF NOT EXISTS seen_cat_ts ON seen (cat, ts);
