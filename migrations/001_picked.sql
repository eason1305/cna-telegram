-- 001: 改用中央社編輯清單（聚焦／新聞圖表／特派看世界）決定推播內容
--
-- 套用方式（本機與正式各跑一次）：
--   npx wrangler d1 execute cna --local  --file=./migrations/001_picked.sql
--   npx wrangler d1 execute cna --remote --file=./migrations/001_picked.sql
--
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 不支援 IF NOT EXISTS，
-- 重複執行本檔會在第一行就噴 "duplicate column name: aid" 而中止。
-- 這是一次性 migration，正常情況只需執行一次。

-- ---------------------------------------------------------------------------
-- seen 表：原本只存去重紀錄，現在要兼任「文章 ID → 前言」查找表。
--
-- 推播時機與掃描時機分離之後，前言必須在掃描當下就存下來：
-- RSS feed 只保留 4～5 小時（實測國際/產經/生活為 4.1～4.5 小時），
-- 而圖表每天、特派每週才檢查一次，推播當下再去抓 feed 一定來不及。
-- ---------------------------------------------------------------------------

ALTER TABLE seen ADD COLUMN aid  TEXT;   -- 12 位文章 ID，取自 guid 尾碼，與清單頁 join 用
ALTER TABLE seen ADD COLUMN link TEXT;   -- 原文連結
ALTER TABLE seen ADD COLUMN head TEXT;   -- 發稿訊頭「（中央社記者OOO台北16日電）」
                                         -- 只存訊頭不存完整前言：前言由 Telegram 預覽卡片
                                         -- 從 og:description 呈現，而訊頭是預覽永遠不會顯示的那塊

-- 清單頁查訊頭時唯一會用到的索引。沒有它每次推播都要全表掃描，
-- 而 D1 免費額度是按「掃描了幾列」計費的。
CREATE INDEX IF NOT EXISTS seen_aid ON seen (aid);

-- 回填既有資料的 aid。
--
-- 這步不能省：scan() 用的是 INSERT OR IGNORE，既有的 guid 會被直接忽略，
-- 所以舊列的 aid 永遠不會被後續掃描補上，join 時會永遠對不上。
-- guid 格式為 CNA/2026-09-16/202609160377，末 12 碼就是文章 ID。
-- （訊頭無法回填，當初沒存前言。這些舊列只影響上線當下那幾小時的項目，
--   而那些項目會在灌種時被標記為已推，不會實際送出。）
--
-- 判斷末 12 碼是不是數字，刻意用數值比較而非 GLOB '[0-9][0-9]...'：
-- SQLite 對 12 個連續字元類會直接噴 "LIKE or GLOB pattern too complex"，
-- 整個 migration 會在這裡中止。合法的文章 ID 形如 202609160377，
-- 必定遠大於 1e11；非數字字串 CAST 後會變成很小的值而被排除。
UPDATE seen
   SET aid = substr(guid, length(guid) - 11)
 WHERE aid IS NULL
   AND length(guid) >= 12
   AND CAST(substr(guid, length(guid) - 11) AS INTEGER) >= 100000000000;

-- ---------------------------------------------------------------------------
-- picked 表：記錄三個編輯清單看過哪些文章、推播了哪些。
--
-- aid 設為 PRIMARY KEY 是整個機制的核心，一次解決三個問題：
--  1. 去重 —— INSERT OR IGNORE 是原子操作，不需要「先查再寫」
--  2. 跨來源去重 —— 三個清單共用這張表，同一篇文章不論被哪個清單先看到，
--     另一個的寫入都會被主鍵擋下，絕不會推兩次
--  3. 競態安全 —— 多個 Worker 實例同時寫入同一個 aid 也只有一個會成功
--
-- 刻意不使用「過去 N 小時」這類時間窗來判斷該不該推：
-- 圖表清單橫跨 50 天、特派橫跨 88 天，且兩者分別每天／每週才跑一次。
-- 用時間窗的話，某次執行失敗就會永久漏稿；用去重表則下次自動補上。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS picked (
  aid       TEXT PRIMARY KEY,   -- 12 位文章 ID
  source    TEXT NOT NULL,      -- 'headlines' | 'chart' | 'world'（最先看到它的來源）
  slug      TEXT NOT NULL,      -- 網址分類代碼 aipl / aopl / acn …，用來還原分類名稱
  title     TEXT NOT NULL,      -- 清單頁上的標題（有 RSS 前言時改用 RSS 的標題）
  url       TEXT NOT NULL,
  pub_at    INTEGER,            -- 發布時間（來自 <time datetime>），判斷要不要等 RSS 補前言
  found_at  INTEGER NOT NULL,   -- 我們第一次看到它的時間
  pushed_at INTEGER             -- NULL = 尚未推播。送出失敗時維持 NULL，下一輪自動重試
);

-- 每次推播都要查「還沒推的有哪些」，這個複合索引讓它不必全表掃描。
CREATE INDEX IF NOT EXISTS picked_pending ON picked (pushed_at, found_at);
