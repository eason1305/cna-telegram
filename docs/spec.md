# 中央社新聞自動推播 Telegram 頻道 — 完整建置指南

用 Cloudflare Workers 把中央社的新聞自動推送到 Telegram 頻道。全程在免費額度內。

推播的不是全部新聞，而是中央社編輯部自己挑進版面的三份清單（聚焦、新聞圖表、特派看世界），每天約 40 則。原因見〈[推播哪些新聞](#推播哪些新聞)〉。

本文件包含**教學步驟**與**所有檔案的完整內容**，照著做完就能上線。

---

## 目錄

**第一部分：教學步驟**

- [授權注意事項（請先讀）](#授權注意事項請先讀)
- [推播哪些新聞](#推播哪些新聞)
- [運作方式](#運作方式)
- [檔案結構總覽](#檔案結構總覽)
- [步驟 0：前置準備](#步驟-0前置準備)
- [步驟 1：建立 Telegram Bot](#步驟-1建立-telegram-bot)
- [步驟 2：建立 Telegram 頻道並取得 chat_id](#步驟-2建立-telegram-頻道並取得-chat_id)
- [步驟 3：建立 Cloudflare 帳號與登入 Wrangler](#步驟-3建立-cloudflare-帳號與登入-wrangler)
- [步驟 4：建立專案](#步驟-4建立專案)
- [步驟 5：建立 D1 資料庫](#步驟-5建立-d1-資料庫)
- [步驟 6：套用資料表結構](#步驟-6套用資料表結構)
- [步驟 7：設定機密變數](#步驟-7設定機密變數)
- [步驟 8：本機測試](#步驟-8本機測試)
- [步驟 9：灌種部署（不要跳過）](#步驟-9灌種部署不要跳過)
- [步驟 10：正式上線](#步驟-10正式上線)
- [步驟 11：監控與維護](#步驟-11監控與維護)

**第二部分：完整檔案內容**

- [檔案 1：src/index.ts](#檔案-1srcindexts)
- [檔案 2：wrangler.jsonc](#檔案-2wranglerjsonc)
- [檔案 3：schema.sql](#檔案-3schemasql)
- [檔案 4：migrations/001_picked.sql](#檔案-4migrations001_pickedsql)
- [檔案 5：migrations/002_tries.sql](#檔案-5migrations002_triessql)
- [檔案 6：package.json](#檔案-6packagejson)
- [檔案 7：tsconfig.json](#檔案-7tsconfigjson)
- [檔案 8：.gitignore](#檔案-8gitignore)
- [檔案 9：.dev.vars.example](#檔案-9devvarsexample)

**第三部分：參考資料**

- [常見問題排查](#常見問題排查)
- [額度用量估算](#額度用量估算)
- [附錄：用 Dashboard 圖形介面建立](#附錄用-dashboard-圖形介面建立)
- [延伸想法](#延伸想法)

---

---

# 第一部分：教學步驟

## 授權注意事項（請先讀）

中央社 RSS 頁面（<https://www.cna.com.tw/about/rss.aspx>）明文規範：

- 同意 RSS 內容用於**個人、非營利組織之非商業用途**
- 引用頁面需標示資料出處，文字標示「中央通訊社」
- 每則新聞都有發稿訊頭（「（中央社記者OOO台北31日電）」），**請勿移除**
- RSS 僅提供標題、前言、文章連結與首圖連結，**擅自引用全文即屬侵權**
- 中央社保留在任何時間要求使用者停止使用的權利

因此本專案的設計：

- 只推送**標題 + 前言 + 首圖 + 原文連結**，不抓全文
- 訊息結尾固定標註「—— 中央通訊社」
- 發稿訊頭原樣保留，不改寫
- 頻道名稱與簡介請明確標示「**非官方**」，並附上聯絡方式
- 頻道不得放廣告、不得接贊助、不得做付費訂閱

收到中央社要求停止的通知時，請停用。

### 兩份規範的關係（重要）

中央社文章頁頁尾另有一句全站聲明：

> 本網站之文字、圖片及影音，非經授權，不得轉載、公開播送或公開傳輸及利用。

這兩份文件不衝突，而是**預設禁止 + 具名例外**的關係。頁尾那句是全站 boilerplate；RSS 頁那份是針對 RSS 內容、對個人與非營利用途開出的具體授權，也就是「非經授權」裡的那個**授權**。本專案整個落在例外範圍內。

特別注意 RSS 規範是**正面列舉**可用項目的：「標題、前言、文章連結與首圖連結」。**前言是被列進清單裡的**，不是灰色地帶，沒有必要自我閹割拿掉。反過來說，清單以外的東西一律不能用。

### 為什麼不做 Telegram Instant View

曾評估過替 cna.com.tw 寫 Instant View（IV）template，讓讀者不必開瀏覽器就能原生閱讀。**結論是不做**，理由記錄如下，避免日後重複討論：

- IV 的產物就是**全文**，正是 RSS 規範點名排除的那一項
- 「全文是 Telegram 伺服器抓的、不是我們抓的」這條防線很弱：template 是我們寫的、`rhash` 連結是我們發的，沒有這兩個動作全文不會以那個形式出現在 Telegram。而且 Telegram 會把渲染結果快取在自己的伺服器上
- 純超連結在實務上一般認為只是「指引路徑」；IV 把指路變成「換個地方重新上架」，性質不同
- 效果上，IV 讓這個頻道從「替中央社導流」變成「截流」——沒有他們的廣告、流量統計與版面。這會明顯提高被要求停用的機率

技術上是可行的（IV 官方審核通道雖已停擺多年，但 `t.me/iv?url=...&rhash=...` 這種連結不需審核即可用），**擋住的是授權不是技術**。

替代方案：Telegram 內建瀏覽器本身就支援把任意頁面轉成 reader 版面（開啟連結後 → 瀏覽器設定 → 「Show Instant View」，底層是 Mozilla Readability）。讀者本來就不會離開 Telegram，要 reader 版面多點兩下就有。建議在頻道置頂說明即可。

同理排除用 Telegraph（`telegra.ph`）產生頁面：那是由我們自己抓全文並重製發布，踩線更明確。

---

## 推播哪些新聞

**結論：沿用中央社編輯部自己的判斷，程式不評價新聞價值。**

最早的版本是把 11 個分類的 RSS 無差別推播，實測約 400 則／天。實際讀起來不可用：地方類佔壓倒性多數，其中約八成是選戰稿與政府宣傳稿，頻道等於不可讀。

接著試過自行用關鍵字評分篩選，實測後放棄，原因記錄如下以免日後重試：

- **中文沒有詞界。**「軍演」這個關鍵字會把「陸軍演練」一起命中，誤判無法用字串比對解決。
- **讀不出否定語意。**「颱風對台灣無直接影響」會因為含「颱風」而得高分，但它恰好是「不用擔心」的意思。
- **分數解析度太粗。** 當日前 12 名有 8 則並列同分，名次實質上是隨機的。
- **更根本的是權重沒有依據。** 那套分數是手調出來的，調到「看起來順眼」為止，沒有任何外部標準可以驗證它對不對。

改用中央社網站上三份**人工挑選**的版面，它們本來就是編輯台每天在做的事：

| 來源     | 網址                              | 量       | 檢查頻率        |
| -------- | --------------------------------- | -------- | --------------- |
| 聚焦     | `/list/headlines.aspx`            | 約 40 則／天   | 每 5 分鐘 |
| 新聞圖表 | `/topic/newstopic/4479.aspx`      | 約 0.4 則／天  | 每天台北 08:00 |
| 特派看世界 | `/topic/newstopic/4215.aspx`    | 約 1.6 則／週  | 每週日台北 08:00 |

推播量因此降到原本的十分之一左右。

### 為什麼要讀網頁而不是 RSS

官方 `/about/rss.aspx` 只提供 11 個分類 feed，**這三份清單沒有對應的 RSS**，只能解析網頁。

合規性上：`robots.txt` 未禁止這三個路徑；但分頁用的 `/cna2018api/api/*` 被明文禁止，所以程式只取靜態頁面上的 20 則，**不翻頁**。

### 兩套稿件編號（會影響訊頭）

中央社的文章 ID 形如 `202609160377`，末四碼是當日流水號，而且分成兩個系列：

- **0xxx** — 即時新聞，會進 RSS
- **3xxx／5xxx** — 特稿、專欄，**永遠不進 RSS**

證據：連續兩天每分鐘掃描累積的 505 篇 RSS 文章中，3xxx 系列 0 篇；而特派看世界清單上 20/20 全是 3xxx，聚焦與圖表各約 5%。

影響是特稿抓不到發稿訊頭。程式用 `isFeature()` 認出它們、不讓它們白等 RSS（否則每週只跑一次的特派會被延後整整一週），訊息就少一行訊頭，前言與首圖仍由 Telegram 預覽卡片承擔，**不另尋來源**。

---

## 運作方式

四條 Cron，分成三種工作。**拆開的理由是免費方案每次觸發只有 10 ms CPU time**，解析與推播擠在一起會撞上限。

| Cron            | 工作       | 做什麼                                            |
| --------------- | ---------- | ------------------------------------------------- |
| `* * * * *`     | `scan()`   | 掃 1 個 RSS 分類寫入 `seen`，建立「文章 ID → 發稿訊頭」查找表。**不推播** |
| `*/5 * * * *`   | `discover()` + `drain()` | 抓聚焦清單頁記進 `picked`，然後推播。**唯一會推播的一條** |
| `0 0 * * *`     | `discover()` | 抓新聞圖表清單頁記進 `picked`。不推播            |
| `0 0 * * 0`     | `discover()` | 抓特派看世界清單頁記進 `picked`。不推播          |

### 為什麼掃描不能放慢

RSS feed 的深度只有 4～5 小時（實測國際／產經／生活為 4.1～4.5 小時），而圖表每天、特派每週才檢查一次。等到要推播時再去抓 feed 一定來不及，**訊頭必須在掃描當下就落地保存**。11 個分類輪詢 → 每個分類約 11 分鐘掃到一次。

### 為什麼只有一條 Cron 會推播

「撈出還沒推的 → 送出 → 標記已推」是先查再寫，不是原子操作。而每天 UTC 00:00 會有兩條清單 Cron 同時觸發（`*/5` 與 `0 0 * * *`，因為 0 可被 5 整除），週日更是三條。如果它們各自都會推播，就會各自撈到同一批 pending，同一則被送兩三次——`picked.aid` 主鍵只擋得住重複「記錄」，擋不住重複「推播」。

讓同時只存在一個推播者是最省的解法：不需要鎖、不需要租約欄位，也不必依賴「把分鐘數錯開」這種一加新 Cron 就會破功的算術。圖表與特派不會因此變慢——它們被記錄下來後，最多 5 分鐘就被每 5 分鐘那條撿走。

**要加新 Cron 的話，除非你確定它永遠不會與 `*/5` 同分鐘觸發，否則不要讓它推播。**

### 去重與重試

去重完全靠 `picked.aid` 主鍵加 `INSERT OR IGNORE`（原子操作），**刻意不使用「過去 N 小時」這類時間窗**：圖表清單橫跨 50 天、特派橫跨 88 天，用時間窗的話某次執行失敗就是永久漏稿，用去重表則下次自動補上。三份清單共用同一張表，所以同一篇文章不論被哪份先看到都只會推一次。

送出成功才寫 `pushed_at`；失敗則維持 `NULL` 由下一輪重試，並把 `tries` 加一。排序的第一順位是 `tries`，所以失敗過的會沉到隊尾、新聞永遠排在它前面——沒有這一欄的話，一則永遠送不出去的稿件會卡在隊首，把後面所有新聞堵死而且不會報錯。

刻意**不設「試 N 次就放棄」的門檻**：token 失效這類系統性故障會讓每一則都累積 `tries`，有門檻的話一次兩小時的故障就等於把整批新聞永久丟掉。真的卡住的那幾則靠 `/stats` 的 `stuck` 計數與 `npm run db:stuck` 看見，人工處理。

---

## 檔案結構總覽

```
cna-telegram/
├── src/
│   └── index.ts            ← 主程式（掃 RSS、讀清單頁、去重、推播）
├── migrations/
│   ├── 001_picked.sql      ← 既有資料庫升級用：新增 picked 表
│   └── 002_tries.sql       ← 既有資料庫升級用：新增 tries 欄位
├── schema.sql              ← D1 資料表結構（全新環境用這份，不必跑 migrations）
├── wrangler.jsonc          ← Cloudflare Workers 設定檔
├── package.json            ← 相依套件與常用指令
├── tsconfig.json           ← TypeScript 設定
├── .gitignore              ← 排除 node_modules 與機密檔案
└── .dev.vars.example       ← 本機環境變數範本
```

| 檔案                | 你需要修改嗎 | 說明                                                          |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `src/index.ts`      | 可選         | 想增減來源就改 `SOURCES`；想調訊息格式就改 `sendMessage()`    |
| `migrations/*.sql`  | 不用         | **全新環境用不到**，只有既有資料庫升級時才跑                  |
| `schema.sql`        | 不用         | 直接套用                                                      |
| `wrangler.jsonc`    | **要**       | 必須填入步驟 5 取得的 `database_id`                           |
| `package.json`      | 不用         | 提供 `npm run` 捷徑                                           |
| `tsconfig.json`     | 不用         | 讓編輯器認得 Workers 的型別                                   |
| `.gitignore`        | 不用         | 直接用                                                        |
| `.dev.vars.example` | 要           | 複製成 `.dev.vars` 並填值（僅本機測試用）                     |

> `schema.sql` 與 `migrations/` 是兩條路，不要都跑。**全新環境只跑 `schema.sql`**，它已經包含所有 migration 的結果。`migrations/` 是給已經在跑舊版、資料不能刪的人逐步升級用的。

---

## 步驟 0：前置準備

需要三樣東西：

**1. Node.js 20 或以上**

```bash
node -v     # 應顯示 v20.x 或更高
```

沒有的話到 https://nodejs.org 下載 LTS 版，或用 Homebrew：`brew install node`

**2. Cloudflare 帳號** — 免費註冊，這個用途不需要綁信用卡

**3. Telegram 帳號**

---

## 步驟 1：建立 Telegram Bot

1. 在 Telegram 搜尋並開啟 **@BotFather**（注意有官方認證勾勾）
2. 送出 `/newbot`
3. 依提示輸入：
   - **顯示名稱**：例如 `中央社新聞（非官方）`
   - **使用者名稱**：必須以 `bot` 結尾，例如 `cna_unofficial_bot`
4. BotFather 會回給你一串 token，格式是「數字 + 冒號 + 一長串英數字」：

```
<8~10 位數字>:<35 碼英數字、底線或減號>
```

（這裡刻意不放完整範例字串。只要文件裡出現長得像真 token 的東西，
GitHub secret scanning 就會發告警信，即使那是假的。）

**這串就是密碼，拿到就能完全控制你的 bot。先存在密碼管理員裡，步驟 7 要用。**

建議順手設定（都在 BotFather 裡）：

- `/setdescription` — 設定 bot 說明
- `/setuserpic` — 設定頭像

---

## 步驟 2：建立 Telegram 頻道並取得 chat_id

### 2-1 建立頻道

1. Telegram 左上角選單 → **New Channel**
2. 頻道名稱：例如 `中央社新聞速報（非官方）`
3. 頻道簡介建議寫明：

```
本頻道為非官方自動轉發，內容來源為中央通訊社公開 RSS，
僅提供標題、前言、首圖與原文連結。所有著作權歸中央通訊社所有。
非營利、無廣告。聯絡：@你的帳號
```

4. 選 **Public Channel**（公開頻道），設定一個連結名稱，例如 `cna_unofficial`
5. 跳過「新增成員」

### 2-2 把 Bot 設為管理員

1. 進入頻道 → 點頻道名稱 → **Administrators** → **Add Administrator**
2. 搜尋你的 bot 使用者名稱（`cna_unofficial_bot`）
3. 權限中**必須勾選「Post Messages」**（發布訊息），其他可全部關閉
4. 確認

> 這步沒做的話，推播會失敗並回傳 `403: bot is not a member of the channel chat`。

### 2-3 取得 chat_id

**公開頻道（推薦）**：直接用 `@` 加上連結名稱即可，不需要查數字 ID。

```
@cna_unofficial
```

**私人頻道**：需要數字 ID，做法是：

1. 在頻道隨便發一則訊息
2. 把那則訊息**轉傳**給 **@userinfobot**
3. 它會回傳頻道 ID，格式類似 `-1001234567890`

或者用 API 查（先在頻道發一則訊息，再開這個網址）：

```
https://api.telegram.org/bot<你的TOKEN>/getUpdates
```

在回傳的 JSON 裡找 `"chat":{"id":-100...}`。

---

## 步驟 3：建立 Cloudflare 帳號與登入 Wrangler

1. 到 https://dash.cloudflare.com/sign-up 註冊，完成 email 驗證
2. 記下你的帳號 ID（Dashboard 右側可以看到），排查問題時偶爾會用到

Wrangler 是 Cloudflare Workers 的命令列工具，不需要全域安裝，下一步建專案時會自動裝進專案裡。

---

## 步驟 4：建立專案

### 方法 A：手動建立（推薦，因為檔案內容都在第二部分）

```bash
mkdir -p cna-telegram/src && cd cna-telegram
```

（如果你是要把既有的舊版升級上來，再多建一個 `migrations` 目錄。全新環境用不到。）

然後依照**第二部分**把檔案一個一個建立起來（全新環境不需要 `migrations/` 那兩份），最後：

```bash
npm install
```

### 方法 B：從 Cloudflare 模板開始

```bash
npm create cloudflare@latest -- cna-telegram
```

互動選項這樣選：

- **What would you like to start with?** → `Hello World example`
- **Which template would you like to use?** → `Worker only`
- **Which language do you want to use?** → `TypeScript`
- **Do you want to use git for version control?** → `Yes`
- **Do you want to deploy your application?** → **`No`**（還沒設定好，先不要部署）

建好後用第二部分的內容覆蓋 `src/index.ts` 與 `wrangler.jsonc`，並補上 `schema.sql`。

### 登入 Cloudflare

```bash
npx wrangler login
```

會開啟瀏覽器要你授權。成功後終端機會顯示 `Successfully logged in`。

驗證一下：

```bash
npx wrangler whoami
```

---

## 步驟 5：建立 D1 資料庫

```bash
npx wrangler d1 create cna
```

輸出會類似：

```
✅ Successfully created DB 'cna'

[[d1_databases]]
binding = "DB"
database_name = "cna"
database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"
```

**把那串 `database_id` 複製下來，填進 `wrangler.jsonc`：**

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "cna",
    "database_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab"   // ← 貼在這裡
  }
]
```

> `binding` 是程式裡 `env.DB` 對應的名稱，**不要改**，改了程式會找不到資料庫。

---

## 步驟 6：套用資料表結構

先在**本機**資料庫建表（供本機測試用）：

```bash
npx wrangler d1 execute cna --local --file=./schema.sql
```

再在**正式**資料庫建表：

```bash
npx wrangler d1 execute cna --remote --file=./schema.sql
```

系統會問你確認，輸入 `y`。

驗證建表成功：

```bash
npx wrangler d1 execute cna --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

應該看到 `seen` 與 `picked` 兩張表。

- **`seen`** — RSS 掃描的產物，身兼去重紀錄與「文章 ID → 發稿訊頭」查找表
- **`picked`** — 三份編輯清單看過哪些文章、推播了哪些

> `--local` 和 `--remote` 是兩個完全獨立的資料庫。本機測試的資料不會影響正式環境，反之亦然。**忘記加 `--remote` 是最常見的卡點**，症狀是本機測試都正常、部署後噴 `no such table: picked`。

### 如果你是從舊版升級

已經有資料在跑、不想砍掉重來的話，**不要跑 `schema.sql`**（`CREATE TABLE IF NOT EXISTS` 不會幫既有的表加欄位），改成依序套用 migrations：

```bash
npm run db:migrate:local && npm run db:migrate
```

```bash
npm run db:migrate:002:local && npm run db:migrate:002
```

兩點要注意：

- **SQLite 的 `ALTER TABLE ADD COLUMN` 不支援 `IF NOT EXISTS`**，重複執行會噴 `duplicate column name` 並中止。這兩份都是一次性的，正常情況各跑一次。
- **migration 必須在部署新版程式之前跑完**，否則新版的查詢會找不到 `picked` 表或 `tries` 欄位。

---

## 步驟 7：設定機密變數

Token 這類敏感資料要用 `secret`，它會加密存在 Cloudflare，不會出現在你的程式碼或設定檔裡。

```bash
npx wrangler secret put TG_TOKEN
# 貼上步驟 1 的 token，按 Enter（輸入時不會顯示，正常）

npx wrangler secret put TG_CHAT
# 輸入 @cna_unofficial （或私人頻道的 -100... 數字）
```

確認已設定：

```bash
npx wrangler secret list
```

**本機測試用的變數是分開的**，複製範本並填值：

```bash
cp .dev.vars.example .dev.vars
# 用編輯器打開 .dev.vars 填入真實值
```

`.dev.vars` 已列在 `.gitignore`，不會被提交到 git。

---

## 步驟 8：本機測試

```bash
npm run dev
```

（等同 `npx wrangler dev --test-scheduled`）

終端機會顯示本機網址，通常是 `http://localhost:8787`。**注意此時 `.dev.vars` 裡的 `SEED_ONLY` 應該是 `1`，不會真的推播。**

### 測試 HTTP 端點

開另一個終端機視窗。四個端點對應到程式裡三種工作：

```bash
# 健康檢查
curl http://localhost:8787
# → alive
```

```bash
# 掃一個 RSS 分類建立訊頭查找表（不推播）
curl http://localhost:8787/run
# → 產經: parsed 15, new 15
```

```bash
# 抓一份編輯清單記進 picked（不推播）
curl "http://localhost:8787/pick?src=headlines"
# → headlines: parsed 19, new 19
```

`src` 可以是 `headlines`、`chart`、`world`，給錯會回 400 並列出可用值。

```bash
# 把 picked 裡還沒推的送出去
curl http://localhost:8787/push
# → drain: skipped (seed mode)
```

`SEED_ONLY=1` 時 `drain()` 直接跳過，所以現在看到的是 `skipped`。真的要送出的測法見下面〈真的測試推播〉。正常推播時這裡會是 `drain: sent 3`，或 `drain: sent 1, waiting 2`。

```bash
# 看統計
curl http://localhost:8787/stats
# → {"tracked":39,"pushed":39,"stuck":0,"latest":"2026-09-16T...","bySource":{"headlines":19,"chart":20}}
```

灌種模式下 `tracked` 與 `pushed` 相等——所有列一寫進去就被視為已推，這正是灌種要的效果。`stuck` 是「還沒推出去而且已經失敗三次以上」的數量，平常應該是 0。

> `/push` 和每 5 分鐘的 Cron 都會推播，兩者同時跑會重複推播，所以這個端點只適合在本機、或確定 Cron 沒在跑的時候用。

### 測試 Cron 排程

`--test-scheduled` 會開放一個特殊路徑讓你模擬排程觸發。四條分別是：

```bash
curl --get "http://localhost:8787/__scheduled" --data-urlencode "cron=* * * * *"
```

```bash
curl --get "http://localhost:8787/__scheduled" --data-urlencode "cron=*/5 * * * *"
```

```bash
curl --get "http://localhost:8787/__scheduled" --data-urlencode "cron=0 0 * * *"
```

```bash
curl --get "http://localhost:8787/__scheduled" --data-urlencode "cron=0 0 * * 0"
```

輸出都是 `Ran scheduled event`，實際結果看 `npm run dev` 那個視窗的日誌。

**值得親自看一次的對照**：打 `0 0 * * *`（新聞圖表）時，日誌只會有 `chart: parsed 20, new 20`，**不會有任何推播**；改打 `*/5 * * * *` 才會在 `headlines: parsed ...` 之後接著出現 `drain: sent ...`。這就是「只有一條 Cron 會推播」的實際樣子。

### 檢查本機資料庫內容

```bash
npx wrangler d1 execute cna --local --command="SELECT source, slug, title FROM picked LIMIT 5"
```

```bash
npx wrangler d1 execute cna --local --command="SELECT aid, head FROM seen WHERE head != '' LIMIT 5"
```

### 真的測試推播

把 `.dev.vars` 裡的 `SEED_ONLY` 改成 `0`，重啟 `npm run dev`，然後：

```bash
npx wrangler d1 execute cna --local --command="UPDATE picked SET pushed_at = NULL WHERE aid IN (SELECT aid FROM picked LIMIT 2)"
```

```bash
curl http://localhost:8787/push
```

> 只解開 2 則是為了不要一次灌一堆到頻道裡。不要用 `DELETE FROM picked` 清空——那會讓下一次 `/pick` 把整份清單 20 則全部當成新的推出去。

去頻道確認這幾項，確認完記得把 `SEED_ONLY` 改回 `1`：

- **標題整行可點**（藍色粗體），點下去進得了中央社原文
- **大圖預覽卡有出真實文章照片**（少數沒配圖的稿會退回中央社的通用圖，正常）
- **前言只出現一次**——在預覽卡裡。訊息本文只該有標題、訊頭、出處
- 分類 emoji 對得上分類，沒有亂碼
- 發稿訊頭完整，沒有被截斷。**特稿（3xxx／5xxx 系列）沒有訊頭是正常的**，會少一行
- 圖表與特派的訊息結尾多一段來源標記（`📊 新聞圖表`／`🌍 特派看世界`）

---

## 步驟 9：灌種部署（不要跳過）

**這步跳過的話，你的頻道上線瞬間會被幾百則舊新聞洗版，清理很麻煩。**

**不要去改 `wrangler.jsonc`。** 那裡的 `SEED_ONLY` 固定是正式值 `"0"`，灌種用專門的指令以 `--var` 覆蓋：

```bash
npm run deploy:seed
```

（等同 `wrangler deploy --var SEED_ONLY:1`）

> 為什麼不直接改設定檔：改了就得記得改回來。只要忘記一次，之後任何一次不帶 `--var` 的 `npm run deploy` 都會靜默退回灌種模式——頻道停止推播，而且不會報任何錯，你只會發現「怎麼好久沒更新」。用指令覆蓋則是每次部署都必須明確表態。

輸出會顯示你的 Worker 網址，類似：

```
https://cna-telegram.<你的帳號子網域>.workers.dev
Current Version ID: xxxx-xxxx-xxxx
```

**接下來等至少 12 分鐘**（11 個分類 × 每分鐘輪一個，讓每個分類都被掃過一遍，訊頭查找表才有東西）。

期間可以開著日誌觀察：

```bash
npm run tail
```

會看到每分鐘一則掃描紀錄，以及每 5 分鐘一則清單紀錄：

```
科技: parsed 15, new 15
生活: parsed 15, new 15
headlines: parsed 19, new 19 (seed mode)
```

灌種模式下 `discover()` 會把 `pushed_at` 直接填成現在，等於「記錄下來但視為已推」。**少了這步，上線瞬間三份清單合計約 60 則會全部推出**（圖表清單橫跨 50 天、特派橫跨 88 天）。

聚焦每 5 分鐘就會抓一次，但**圖表與特派只在台北 08:00 才跑**。如果你不想等到隔天，手動打一次把它們也灌進去：

```bash
curl "https://cna-telegram.<你的子網域>.workers.dev/pick?src=chart"
```

```bash
curl "https://cna-telegram.<你的子網域>.workers.dev/pick?src=world"
```

確認資料庫已灌種：

```bash
npm run db:count
```

三個來源都該出現，而且 `pending` 全是 0：

```
┌───────────┬────┬─────────┐
│ source    │ n  │ pending │
├───────────┼────┼─────────┤
│ headlines │ 19 │ 0       │
│ chart     │ 20 │ 0       │
│ world     │ 20 │ 0       │
└───────────┴────┴─────────┘
```

**`pending` 不是 0 就代表灌種沒生效**，上線後那幾則會被推出去。檢查 `SEED_ONLY` 是不是真的是 `1`。

---

## 步驟 10：正式上線

一樣不動 `wrangler.jsonc`，直接重新部署即可——不帶 `--var` 時就是設定檔裡的正式值 `"0"`：

```bash
npm run deploy
```

（想講得更明確也可以用 `npm run deploy:prod`，等同 `wrangler deploy --var SEED_ONLY:0`，結果一樣。）

從現在開始，只有**新進聚焦／圖表／特派清單**的稿件會被推送。開著日誌觀察：

```bash
npm run tail
```

聚焦大約每小時更新 2 則，所以第一則實際推播可能要等上半小時，日誌長這樣：

```
headlines: parsed 19, new 1
drain: sent 1
```

`new 0` 是常態，代表清單沒變動。`drain: sent 0, waiting 1` 也是正常的——那表示有一則剛發布、還沒掃到訊頭，程式在等 RSS 補上（最多等 30 分鐘，見 `WAIT_MS`）。

到頻道確認訊息正常後就完成了。

---

## 步驟 11：監控與維護

### 日常指令

```bash
npm run tail              # 即時日誌（Ctrl+C 離開）
npm run db:count          # 各來源累積數與待推數
npm run db:recent         # 最近 10 則（時間已轉台北時區）
npm run db:nohead         # 推出去但沒帶到訊頭的有幾則
npm run db:stuck          # 送不出去、tries 累積中的是哪幾則
npm run db:purge          # 清掉 90 天前的 seen 紀錄
```

`db:nohead` 的數字要分開看：**特派看世界接近 100% 沒有訊頭是正常的**（那份清單全是特稿，本來就不進 RSS）；但如果**聚焦**的比例明顯上升，代表 RSS 掃描跟不上，該檢查每分鐘那條 Cron 是不是掛了。

`db:stuck` 平常應該是空的。有東西就表示那幾則一直送不出去，手動看一下錯在哪；確認不值得再試的話直接標成已推：

```bash
npx wrangler d1 execute cna --remote --command="UPDATE picked SET pushed_at = unixepoch()*1000 WHERE aid = '<那則的 aid>'"
```

### Dashboard 查看

Cloudflare Dashboard → **Workers & Pages** → 點選 `cna-telegram`：

- **Metrics** — 請求數、CPU time、錯誤率。**CPU time 的 P99 值是唯一要長期盯的指標**，接近 10 ms 就要警覺
- **Logs** — `console.log` 輸出（需要 `wrangler.jsonc` 裡 `observability.enabled` 為 `true`）
- **Settings → Triggers** — 確認 Cron 排程還在

### 重要提醒：Cron 失敗不會通知你

Cloudflare 不會在排程失敗時寄信或重試。如果 Worker 掛了，你只會發現「頻道好久沒更新」。

想要主動告警，最簡單的做法是另外做一個每日檢查：用手機的捷徑／自動化每天打一次 `https://你的worker網址/stats`，如果 `latest` 超過幾小時沒更新、或 `stuck` 不是 0 就提醒你。

### 最可能的長期故障模式：清單頁改版

這套方案靠解析 HTML，中央社改版就會壞。**而且壞法是安靜的**——`parseList()` 找不到 `id="jsMainList"` 時回傳空陣列，不會拋錯，頻道就此不再更新。

程式為此在解析結果為 0 時留了痕跡，日誌會出現：

```
headlines: parsed 0 items — 清單頁結構可能已變更
```

`npm run tail` 看到這行，或 `/stats` 的 `tracked` 長期不動，就是該去看頁面結構了。要修的是 `src/index.ts` 裡的 `parseList()` 與 `RE_HREF`／`RE_H2`／`RE_DATETIME` 三條正則。

### 更新程式碼

改完 `src/index.ts` 後：

```bash
npm run deploy
```

部署是原子的，不會有中斷。要回滾的話，Dashboard → **Deployments** 可以選舊版本。

**如果這次更新含 migration，先跑 migration 再部署。** 反過來的話，新版程式會有一段時間查不到欄位而整批報錯。

### 手動觸發（正式環境）

```bash
curl https://cna-telegram.<你的子網域>.workers.dev/run
```

```bash
curl "https://cna-telegram.<你的子網域>.workers.dev/pick?src=chart"
```

> 這些端點是公開的，`/push` 尤其要小心——它會真的推播，而且與每 5 分鐘的 Cron 同時跑會造成重複推播。如果你在意有人亂打，可以在程式裡加一個簡單的 query token 檢查，或只留 `/stats`。

---

---

# 第二部分：完整檔案內容

## 檔案 1：`src/index.ts`

主程式。註解寫的是「為什麼這樣寫」，不只是「做了什麼」——特別是 `parseItems()` 為何用正則而非 XML 解析器、`RE_ITEM.lastIndex = 0` 為何必要、`clean()` 裡 `&amp;` 為何必須放最後、`parseList()` 為何先用 `indexOf` 切出區段再跑正則、為何以 `<li>` 切塊而不是用一條長正則、為何只有一條 Cron 能推播、`href` 為何一定要 `escapeHtml()`。這些是之後你自己改動時最容易踩到的地方。

三個主要函式的分工：

| 函式         | 做什麼                                       | 碰解析嗎 |
| ------------ | -------------------------------------------- | -------- |
| `scan()`     | 掃 1 個 RSS 分類寫入 `seen`，建訊頭查找表    | XML      |
| `discover()` | 抓 1 份編輯清單頁寫入 `picked`               | HTML     |
| `drain()`    | 把 `picked` 裡還沒推的送出去                 | 都不碰   |

訊息長這樣（標題整行是超連結，下面接大圖預覽卡）：

```
💻 泰國專家：AI治理與發展非二選一　應先釐清責任歸屬
（中央社記者李宗憲曼谷16日專電）
—— 中央通訊社 · 科技
```

圖表與特派的稿件會在結尾多一段來源標記：

```
🌏 特派看世界：從這條街看懂一座城的分裂
—— 中央通訊社 · 國際 · 🌍 特派看世界
```

**中間那行訊頭可能不存在**，特稿系列（3xxx／5xxx）永遠抽不到，這時訊息就少一行，前言與首圖仍由預覽卡片承擔。

分類 emoji 對照：🏛️ 政治／🌏 國際／🌊 兩岸／📈 產經／💻 科技／🌿 生活／🚨 社會／📍 地方／🎨 文化／🏅 運動／🎬 娛樂。建議在頻道也置頂一則對照表——11 個 emoji 讀者記不住，所以結尾那行的分類名稱**不要拿掉**，emoji 負責掃視、文字負責消歧義。

編輯清單頁只給網址不給分類名稱，分類是靠網址裡的代碼（`aipl`／`aopl`／`acn` …）反查回來的，所以 `FEEDS` 每一列的第四欄 `urlSlug` 不能漏。

```typescript
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
  /** "1" = 只寫入資料庫、不實際推播（首次上線灌種用） */
  SEED_ONLY: string;
}

type Item = {
  guid: string;
  /** 12 位文章 ID，與編輯清單頁對接的唯一鍵 */
  aid: string;
  title: string;
  link: string;
  /** 中央社發稿訊頭，例：「（中央社記者李宗憲曼谷16日專電）」。抽不出來時為空字串 */
  head: string;
};

/** 編輯清單頁上的一則新聞 */
type Pick = {
  aid: string;
  /** 網址裡的分類代碼 aipl / aopl / acn … */
  slug: string;
  title: string;
  url: string;
  pubAt: number | null;
};

/** 準備送往 Telegram 的一則訊息 */
type Outgoing = {
  emoji: string;
  title: string;
  link: string;
  head: string;
  category: string;
  /** 來源標記，例「📊 新聞圖表」。聚焦為空字串 */
  tag: string;
};

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 轉義成 Telegram HTML parse_mode 可以安全接受的文字 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 清理 RSS／HTML 欄位內容：
 *  - 剝掉 <![CDATA[ ... ]]> 外殼
 *  - 移除殘留的 HTML 標籤（清單頁的標題包在 <span> 裡，靠這步剝掉）
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

/** 從 guid 或連結取出 12 位文章 ID，這是與編輯清單頁對接的唯一鍵 */
function extractAid(guid: string, link: string): string {
  return (guid.match(/(\d{12})$/) ?? link.match(/\/(\d{12})\.aspx/))?.[1] ?? "";
}

/** 文章 ID 末 4 碼是當日流水號，用來分辨即時新聞（0xxx）與特稿（3xxx 以上） */
const isFeature = (aid: string): boolean =>
  Number(aid.slice(-4)) >= FEATURE_SEQ;

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
function parseList(html: string): Pick[] {
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
  "0 0 * * 0": { src: "world", drain: false }, // 每週日台北 08:00
};

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

export default {
  /** Cron 排程觸發 */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const job = CRON_JOBS[controller.cron];
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
```

---

## 檔案 2：`wrangler.jsonc`

Workers 設定檔。**你必須修改 `database_id`**（步驟 5 取得）。

四條 Cron 的字串必須與 `src/index.ts` 裡 `CRON_JOBS` 的 key 逐字一致，改一邊就要改另一邊。

```jsonc
{
  // Worker 名稱，會成為 *.workers.dev 子網域的一部分
  "name": "cna-telegram",

  // 進入點
  "main": "src/index.ts",

  // 相容性日期：決定 Workers runtime 的行為版本。設定後就不要隨意往前調，
  // 否則可能踩到 runtime 行為變更。要更新時請先在本機測過。
  "compatibility_date": "2026-08-01",

  // Cron 排程（UTC 時區，最小粒度 1 分鐘）
  //
  // 解析與推播刻意分開：解析 XML／HTML 的工作不推播，推播的工作完全不碰解析，
  // 這樣每次觸發都能待在免費方案的 10 ms CPU 上限內。
  // 排程字串要與 src/index.ts 的 CRON_JOBS 完全一致，改這裡就要一起改那裡。
  //
  //   "* * * * *"    每分鐘掃一個 RSS 分類建立訊頭查找表，不推播
  //                  11 個分類輪詢 → 每個分類約 11 分鐘掃一次
  //   "*/5 * * * *"  聚焦。該頁約每小時更新 2 則，5 分鐘是 24 倍超取樣
  //                  **這是唯一會推播的一條**
  //   "0 0 * * *"    新聞圖表。UTC 00:00 = 台北 08:00。只記錄，不推播
  //   "0 0 * * 0"    特派看世界。每週日台北 08:00（台灣無日光節約時間，換算固定）
  //                  只記錄，不推播
  //
  // 為什麼只有一條推播：週日 UTC 00:00 這四條會同時觸發（0 可被 5 整除）。
  // 「撈出還沒推的 → 送出 → 標記已推」是先查再寫，兩個實例同時跑會各自撈到
  // 同一批，同一則就被送兩三次。讓同時只存在一個推播者是最省的解法。
  // 圖表與特派不會因此變慢——它們記錄下來後，最多 5 分鐘就被上面那條撿走。
  //
  // 免費方案每帳號最多 5 個 Cron Trigger，這裡用 4 個，保留 1 個餘裕。
  // 要加新 Cron 的話，除非你確定它永遠不會與 "*/5" 同分鐘觸發，否則不要讓它推播。
  "triggers": {
    "crons": ["* * * * *", "*/5 * * * *", "0 0 * * *", "0 0 * * 0"],
  },

  // D1 資料庫綁定
  // binding       = 程式裡 env.DB 的名稱，不要改
  // database_name = 你執行 `wrangler d1 create cna` 時給的名稱
  // database_id   = 上述指令回傳的 UUID，請填進去
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cna",
      "database_id": "8068ea04-6a5a-48ca-9f49-786745bbae92",
    },
  ],

  // 非敏感的環境變數（敏感的請用 wrangler secret put）
  // SEED_ONLY = "1" → 只寫入去重資料庫、不推播，用於首次上線灌種
  // SEED_ONLY = "0" → 正常推播
  //
  // 這裡固定放正式值 "0"。灌種請用 `npm run deploy:seed`（以 --var 覆蓋成 "1"），
  // 不要把預設值改回 "1"：那樣之後任何一次不帶 --var 的 `npm run deploy`
  // 都會靜默退回灌種模式，頻道停止推播而且不會報錯。
  "vars": {
    "SEED_ONLY": "0",
  },

  // 開啟可觀測性，這樣 dashboard 的 Logs 才看得到 console.log 輸出
  "observability": {
    "enabled": true,
  },
}
```

---

## 檔案 3：`schema.sql`

**全新環境用這一份就夠了**，它已經包含 `migrations/` 兩份的結果，不要再去跑 migrations。

兩張表：`seen` 是 RSS 掃描的產物（去重紀錄兼訊頭查找表），`picked` 記錄三份編輯清單看過與推播了哪些文章。

```sql
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
  pushed_at INTEGER,            -- NULL = 尚未推播。送出失敗時維持 NULL，下一輪自動重試
  tries     INTEGER NOT NULL DEFAULT 0
                                -- 送出失敗過幾次。排序的第一順位，讓失敗過的沉到隊尾，
                                -- 否則一則永遠送不出去的會卡在隊首，把後面所有新聞堵死
);

-- 排序是 (tries, found_at, pub_at)，索引要跟著走，否則每次都得排序整張表。
CREATE INDEX IF NOT EXISTS picked_pending ON picked (pushed_at, tries, found_at);
```

---

## 檔案 4：`migrations/001_picked.sql`

**全新環境不需要這份。** 只有原本在跑「11 分類無差別推播」那個舊版、資料不能刪的人才要套用。

它新增 `picked` 表，並替 `seen` 補上 `aid`／`link`／`head` 三個欄位。最後那段 `UPDATE` 是必要的：`scan()` 用 `INSERT OR IGNORE`，既有的 `guid` 會被直接忽略，舊列的 `aid` 永遠不會被後續掃描補上，不回填的話 join 會永遠對不上。

```sql
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
```

---

## 檔案 5：`migrations/002_tries.sql`

**全新環境不需要這份。**

它替 `picked` 加上 `tries` 欄位並重建索引，讓送不出去的稿件沉到隊尾而不是卡死整條隊列。理由見〈[運作方式](#運作方式)〉的「去重與重試」。

```sql
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
```

---

## 檔案 6：`package.json`

沒有執行期相依套件，`devDependencies` 只有 wrangler 與型別定義。

`db:migrate*` 那幾條全新環境用不到。`db:purge` 只清 `seen`，**不會動 `picked`**——那是去重表，清掉舊列等於讓那些文章有機會被重推。

```json
{
  "name": "cna-telegram",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev --test-scheduled",
    "deploy": "wrangler deploy",
    "deploy:seed": "wrangler deploy --var SEED_ONLY:1",
    "deploy:prod": "wrangler deploy --var SEED_ONLY:0",
    "tail": "wrangler tail",
    "db:init": "wrangler d1 execute cna --remote --file=./schema.sql",
    "db:init:local": "wrangler d1 execute cna --local --file=./schema.sql",
    "db:migrate": "wrangler d1 execute cna --remote --file=./migrations/001_picked.sql",
    "db:migrate:local": "wrangler d1 execute cna --local --file=./migrations/001_picked.sql",
    "db:migrate:002": "wrangler d1 execute cna --remote --file=./migrations/002_tries.sql",
    "db:migrate:002:local": "wrangler d1 execute cna --local --file=./migrations/002_tries.sql",
    "db:count": "wrangler d1 execute cna --remote --command=\"SELECT source, COUNT(*) AS n, SUM(CASE WHEN pushed_at IS NULL THEN 1 ELSE 0 END) AS pending FROM picked GROUP BY source ORDER BY n DESC\"",
    "db:recent": "wrangler d1 execute cna --remote --command=\"SELECT datetime(pushed_at/1000,'unixepoch','+8 hours') AS t, source, slug, title FROM picked WHERE pushed_at IS NOT NULL ORDER BY pushed_at DESC LIMIT 10\"",
    "db:nohead": "wrangler d1 execute cna --remote --command=\"SELECT p.source, COUNT(*) AS n FROM picked p LEFT JOIN seen s ON s.aid=p.aid WHERE p.pushed_at IS NOT NULL AND (s.head IS NULL OR s.head='') GROUP BY p.source\"",
    "db:stuck": "wrangler d1 execute cna --remote --command=\"SELECT tries, source, slug, title, url FROM picked WHERE pushed_at IS NULL AND tries > 0 ORDER BY tries DESC LIMIT 20\"",
    "db:purge": "wrangler d1 execute cna --remote --command=\"DELETE FROM seen WHERE ts < (unixepoch()-7776000)*1000\"",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^5.20260801.1",
    "typescript": "^5.6.0",
    "wrangler": "^4.0.0"
  }
}
```

---

## 檔案 7：`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

---

## 檔案 8：`.gitignore`

```gitignore
node_modules/
.wrangler/
dist/

# 本機開發用的環境變數，絕對不要提交
.dev.vars
.env
```

---

## 檔案 9：`.dev.vars.example`

複製成 `.dev.vars` 再填入真實值。

```ini
# 本機開發用。複製成 .dev.vars 後填入真實值。
# .dev.vars 已列在 .gitignore，不會被提交。
# 注意：這個檔案只在 `wrangler dev` 本機執行時生效，
#       部署到正式環境的機密要用 `wrangler secret put` 設定。

# TG_TOKEN 格式為 <8~10 位數字>:<35 碼英數字>，此處刻意留空避免觸發 secret scanning
TG_TOKEN=
TG_CHAT=@your_channel_name
SEED_ONLY=1
```

---

---

# 第三部分：參考資料

## 常見問題排查

| 現象                                                      | 原因                            | 解法                                                                |
| --------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `403: bot is not a member of the channel chat`            | Bot 沒被設為頻道管理員          | 回步驟 2-2                                                          |
| `403: not enough rights to send text messages`            | 管理員權限沒勾「Post Messages」 | 回步驟 2-2 勾選                                                     |
| `400: chat not found`                                     | `TG_CHAT` 值錯誤                | 公開頻道要帶 `@`；私人頻道是 `-100` 開頭的負數                      |
| `401: Unauthorized`                                       | Token 錯了                      | `npx wrangler secret put TG_TOKEN` 重設                             |
| `Error 1102 / exceededCpu`                                | 解析超過 10 ms CPU              | 先降 `MAX_ITEMS`（15 → 8）；清單頁那條降不了就升級 $5/月方案        |
| `Too many subrequests`                                    | 單次觸發超過 50 個 subrequest   | 降低 `MAX_SEND`。注意 **D1 查詢也算 subrequest**，算式見該常數註解  |
| `Error 1027`                                              | 超過每日 10 萬次請求            | 這個用途幾乎不可能發生，若發生請檢查是否有人在打你的公開端點        |
| `D1_ERROR: no such table: picked`                         | 忘記在正式資料庫建表或跑 migration | 全新環境跑 `schema.sql`；舊版升級跑 `npm run db:migrate`         |
| `no such column: tries`                                   | 先部署了新版程式才跑 migration  | `npm run db:migrate:002`，順序要反過來                              |
| `duplicate column name: aid`／`: tries`                   | migration 重複執行              | 正常，代表已經套用過了，忽略即可                                    |
| `Cannot read properties of undefined (reading 'prepare')` | `database_id` 沒填或填錯        | 檢查 `wrangler.jsonc`                                               |
| 訊息出現 `&amp;` 之類的字                                 | 實體字元處理順序問題            | 檢查 `clean()` 裡 `&amp;` 是否放在最後一個 replace                  |
| 訊息推了但格式跑掉                                        | 標題含 `<` `>` 等字元           | 確認 `escapeHtml()` 有被套用                                        |
| 完全沒有任何日誌                                          | Cron 沒生效                     | Dashboard → Settings → Triggers 確認四條都在；或重新部署            |
| **頻道安靜但沒有錯誤**                                    | 清單頁改版，`parseList()` 回傳 0 | 日誌找 `parsed 0 items — 清單頁結構可能已變更`，修 `parseList()`   |
| **頻道安靜且 `stuck` > 0**                                | 有稿件一直送不出去              | `npm run db:stuck` 看是哪幾則與錯誤原因                             |
| 同一則被推兩次                                            | 有第二條 Cron 也在推播          | `CRON_JOBS` 裡只能有一個 `drain: true`，理由見〈運作方式〉          |
| 頻道被洗版                                                | 忘記灌種                        | 刪除頻道訊息，`npm run deploy:seed` 重新灌種                        |
| 同一段前言出現兩次                                        | 本文又放了完整 `description`    | `parseItems()` 應只取 `RE_HEAD` 抽出的訊頭，前言交給預覽卡          |
| 沒有預覽卡，訊息只剩標題和訊頭                            | Telegram 抓不到中央社的 og tag  | 多半是暫時性（卡片有快取）；持續發生檢查 `link_preview_options.url` |
| 標題點不動                                                | 標題沒被 `<a>` 包住             | 檢查 `sendMessage()` 的 `text`，emoji 要在 `<a>` **外面**           |
| 某些訊息沒有訊頭                                          | 特稿系列，本來就不進 RSS        | 正常。`npm run db:nohead` 看比例，特派接近 100% 是預期的            |

---

## 額度用量估算

以四條 Cron（每天約 1,730 次觸發）、每天約 400 則 RSS 新聞、約 40 則實際推播計算：

| 項目             | 預估用量        | 免費額度      | 佔比      |
| ---------------- | --------------- | ------------- | --------- |
| Workers 請求數   | 約 1,730 次／日 | 100,000／日   | 1.7%      |
| Workers CPU time | 約 3–6 ms／次   | 10 ms／次     | 30–60% ⚠️ |
| subrequest（每 5 分鐘那條） | 最多 46／次 | 50／次   | 92% ⚠️    |
| subrequest（其餘三條）      | 2–21／次   | 50／次        | 4–42%     |
| D1 rows written  | 約 500／日      | 100,000／日   | 0.5%      |
| D1 rows read     | 約 20,000／日   | 5,000,000／日 | 0.4%      |
| D1 儲存          | 每年約 15 MB    | 5 GB          | ~0%       |

**要盯的是 CPU time 與 subrequest 這兩項，其他距離上限都很遠。**

subrequest 那格的 92% 值得解釋。`*/5` 那條同時做 `discover()` 與 `drain()`，是預算最緊的一次觸發，而且 **D1 的每次查詢也算 subrequest**——官方文件寫的是「A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1」，D1 的「Queries per Worker invocation」那條限制也直接標注 read subrequest limits。只算 Telegram 呼叫會嚴重低估。

悲觀假設（batch 裡每個 statement 都算一次）下的組成：

```
清單頁 fetch                        1
INSERT OR IGNORE × 20 則（batch）   20    ← 樂觀假設是 1
pending SELECT                      1
每則 sendMessage + UPDATE × 12     24
─────────────────────────────────────
合計                               46
```

`MAX_SEND = 12` 就是從這個算式回推的，留 4 個給 429 重試。要調高 `MAX_SEND` 之前先把這張表重算一遍。吞吐量不是問題：聚焦約 40 則／天，而 `drain()` 每天跑 288 次 × 12 = 3,456 則／天的容量。

另外 **`picked` 表不會被清理**（`db:purge` 只清 `seen`）。這是刻意的——它是去重表，清掉舊列等於讓那些文章有機會被重推。一年約 15,000 列，成長量可以忽略。

> 上表的免費額度數字請自行複查 <https://developers.cloudflare.com/workers/platform/limits/> 與 D1 的 limits 頁。Cloudflare 會調整這些數字，我查證時也看到不同第三方來源互相矛盾（例如有來源寫「KV 每日 10 萬讀寫」、有的寫「讀 10 萬、寫 1 千」），請以官方文件為準。

---

## 附錄：用 Dashboard 圖形介面建立

如果你不想用命令列，也可以全程在網頁上操作，但**不推薦**——D1 綁定與程式碼編輯在網頁上很難管理，而且沒有版本控制。

大致流程：

1. Dashboard → **Workers & Pages** → **Create** → **Create Worker** → 命名 → **Deploy**
2. Dashboard → **Storage & Databases** → **D1** → **Create database** → 命名 `cna`
3. 在 D1 資料庫頁面的 **Console** 貼上 `schema.sql` 內容執行
4. 回到 Worker → **Settings** → **Bindings** → **Add** → **D1 database** → 變數名稱填 `DB`，選 `cna`
5. Worker → **Settings** → **Variables and Secrets** → 新增 `TG_TOKEN`（選 Secret 類型）、`TG_CHAT`、`SEED_ONLY`
6. Worker → **Settings** → **Triggers** → **Cron Triggers** → **Add** → **四條都要加**：`* * * * *`、`*/5 * * * *`、`0 0 * * *`、`0 0 * * 0`
7. Worker → **Edit code** → 貼上 `src/index.ts` 內容 → **Deploy**

> 第 6 步的四條字串必須與 `src/index.ts` 裡 `CRON_JOBS` 的 key **逐字一致**，差一個空格就會讓那條排程掉進 `scan()` 分支，清單永遠不會被抓。

網頁編輯器不支援 TypeScript 型別檢查，貼進去前記得把型別註記處理好，或者直接改寫成 JavaScript。

---

## 延伸想法

做熟之後可以考慮：

- **增減來源**：`SOURCES` 裡再加一份中央社的清單頁即可，三份清單的 HTML 結構相同，`parseList()` 不用改。記得同時加對應的 Cron，而且**新 Cron 不要設 `drain: true`**
- **多頻道分流**：一個分類一個頻道，把 `TG_CHAT` 改成依 `slug` 查表
- **Bot 指令**：把 `fetch` handler 接成 Telegram webhook，支援 `/latest 科技` 這類查詢
- **去重強化**：中央社會更新稿件，如果想推「更新版」，可以改成比對標題變化
- **來源備援**：FeedBurner 是 Google 長期低度維護的服務，屬單點風險。程式裡已把 feed 網址抽成 `FEEDS` 常數，要換來源時只需改一處

**不建議再試的**：用關鍵字評分自行篩選新聞。試過，中文沒有詞界、讀不出否定語意、分數解析度太粗，而且權重無從驗證——詳見〈[推播哪些新聞](#推播哪些新聞)〉。要改變推播內容，換清單頁比較實際。

---

## 授權

本指南與程式碼供個人使用。推播的新聞內容著作權屬中央通訊社所有，使用方式請遵守其 RSS 使用規範。
