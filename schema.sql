-- 全新環境的完整資料表結構。
-- 已存在的資料庫請改用 migrations/ 下的檔案逐步套用，不要跑這一份。

-- ---------------------------------------------------------------------------
-- seen：RSS 掃描的產物，身兼兩個角色
--  1. 去重紀錄（原本的用途）
--  2. 「文章 ID → 發稿訊頭」查找表（推播時用）
--
-- 第 2 點是掃描與推播分離後的必要設計：RSS feed 只保留 4～5 小時
-- （實測國際/產經/生活為 4.1～4.5 小時），而編輯清單每天／每週才檢查一次，
-- 推播當下再去抓 feed 一定來不及。所以訊頭必須在掃描當下就落地保存。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seen (
  guid  TEXT    PRIMARY KEY,   -- RSS 的 <guid>，格式 CNA/2026-09-16/202609160377
  aid   TEXT,                  -- 12 位文章 ID，取自 guid 尾碼，與編輯清單頁 join 用
  cat   TEXT    NOT NULL,      -- 分類名稱
  title TEXT,
  link  TEXT,                  -- 原文連結
  head  TEXT,                  -- 發稿訊頭。只存訊頭不存完整前言：前言由 Telegram
                               -- 預覽卡片從 og:description 呈現，訊頭則是預覽不會顯示的那塊
  ts    INTEGER NOT NULL       -- 寫入時間（Unix 毫秒）
);

-- 推播時以 aid 查訊頭，沒有索引會全表掃描。
-- D1 免費額度是按「掃描了幾列」計費的，全表掃描會快速吃光額度。
CREATE INDEX IF NOT EXISTS seen_aid    ON seen (aid);
CREATE INDEX IF NOT EXISTS seen_ts     ON seen (ts);
CREATE INDEX IF NOT EXISTS seen_cat_ts ON seen (cat, ts);

-- ---------------------------------------------------------------------------
-- picked：記錄三個編輯清單（聚焦／新聞圖表／特派看世界）看過與推播了哪些文章。
--
-- aid 設為 PRIMARY KEY 是整個機制的核心，一次解決三個問題：
--  1. 去重 —— INSERT OR IGNORE 是原子操作，不需要「先查再寫」
--  2. 跨來源去重 —— 三個清單共用這張表，同一篇文章不論被哪個清單先看到，
--     另一個的寫入都會被主鍵擋下，絕不會推兩次
--  3. 競態安全 —— 多個 Worker 實例同時寫入同一個 aid 也只有一個會成功
--
-- 刻意不使用「過去 N 小時」這類時間窗來判斷該不該推：
-- 圖表清單橫跨 50 天、特派橫跨 88 天，且分別每天／每週才跑一次。
-- 用時間窗的話某次執行失敗就永久漏稿；用去重表則下次自動補上。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS picked (
  aid       TEXT PRIMARY KEY,   -- 12 位文章 ID
  source    TEXT NOT NULL,      -- 'headlines' | 'chart' | 'world'（最先看到它的來源）
  slug      TEXT NOT NULL,      -- 網址分類代碼 aipl / aopl / acn …，用來還原分類名稱
  title     TEXT NOT NULL,
  url       TEXT NOT NULL,
  pub_at    INTEGER,            -- 發布時間（來自 <time datetime>），判斷要不要等 RSS 補前言
  found_at  INTEGER NOT NULL,   -- 我們第一次看到它的時間
  pushed_at INTEGER             -- NULL = 尚未推播。送出失敗時維持 NULL，下一輪自動重試
);

CREATE INDEX IF NOT EXISTS picked_pending ON picked (pushed_at, found_at);
