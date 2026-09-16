-- 002: picked 加上 tries 欄位，讓送不出去的那一則不會卡死整條隊列
--
-- 套用方式（本機與正式各跑一次）：
--   npx wrangler d1 execute cna --local  --file=./migrations/002_tries.sql
--   npx wrangler d1 execute cna --remote --file=./migrations/002_tries.sql
--
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 不支援 IF NOT EXISTS，
-- 重複執行本檔會在第一行就噴 "duplicate column name: tries" 而中止。
-- 這是一次性 migration，正常情況只需執行一次。

-- ---------------------------------------------------------------------------
-- 原本 drain 的排序固定是 ORDER BY found_at，而任何送出錯誤都會 break。
-- 兩者合起來的後果是：只要有一則永遠送不出去（例如 Telegram 回 400
-- can't parse entities），它就永遠排在隊首，每輪撈出來、失敗、break，
-- 之後的所有新聞再也不會送出，而且不會拋錯——頻道就此安靜。
--
-- 加上 tries 之後排序改成 (tries, found_at, pub_at)：失敗過的自動沉到隊尾，
-- 新聞永遠排在它前面，所以卡不住。
-- ---------------------------------------------------------------------------

ALTER TABLE picked ADD COLUMN tries INTEGER NOT NULL DEFAULT 0;

-- 索引要跟著新的排序走，否則每次 drain 都得排序整張表。
-- D1 免費額度是按「掃描了幾列」計費的。
DROP INDEX IF EXISTS picked_pending;
CREATE INDEX IF NOT EXISTS picked_pending ON picked (pushed_at, tries, found_at);
