# 中央社新聞自動推播 Telegram 頻道 — 完整建置指南

用 Cloudflare Workers 定時抓取中央社 RSS，自動推送到 Telegram 頻道。全程在免費額度內。

本文件包含**教學步驟**與**所有檔案的完整內容**，照著做完就能上線。

---

## 目錄

**第一部分：教學步驟**

- [授權注意事項（請先讀）](#授權注意事項請先讀)
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
- [檔案 4：package.json](#檔案-4packagejson)
- [檔案 5：tsconfig.json](#檔案-5tsconfigjson)
- [檔案 6：.gitignore](#檔案-6gitignore)
- [檔案 7：.dev.vars.example](#檔案-7devvarsexample)

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

## 檔案結構總覽

```
cna-telegram/
├── src/
│   └── index.ts            ← 主程式（抓 RSS、去重、推播）
├── schema.sql              ← D1 資料表結構
├── wrangler.jsonc          ← Cloudflare Workers 設定檔
├── package.json            ← 相依套件與常用指令
├── tsconfig.json           ← TypeScript 設定
├── .gitignore              ← 排除 node_modules 與機密檔案
└── .dev.vars.example       ← 本機環境變數範本
```

| 檔案                | 你需要修改嗎 | 說明                                                          |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `src/index.ts`      | 可選         | 想增減分類就改 `FEEDS` 陣列；想調訊息格式就改 `sendMessage()` |
| `schema.sql`        | 不用         | 直接套用                                                      |
| `wrangler.jsonc`    | **要**       | 必須填入步驟 5 取得的 `database_id`                           |
| `package.json`      | 不用         | 提供 `npm run` 捷徑                                           |
| `tsconfig.json`     | 不用         | 讓編輯器認得 Workers 的型別                                   |
| `.gitignore`        | 不用         | 直接用                                                        |
| `.dev.vars.example` | 要           | 複製成 `.dev.vars` 並填值（僅本機測試用）                     |

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

然後依照**第二部分**把 7 個檔案一個一個建立起來，最後：

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

應該看到 `seen`。

> `--local` 和 `--remote` 是兩個完全獨立的資料庫。本機測試的資料不會影響正式環境，反之亦然。**忘記加 `--remote` 是最常見的卡點**，症狀是本機測試都正常、部署後噴 `no such table: seen`。

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

開另一個終端機視窗：

```bash
# 健康檢查
curl http://localhost:8787
# → alive

# 手動執行一輪（會抓 RSS、寫入本機 D1）
curl http://localhost:8787/run
# → 科技: parsed 15, sent 0 (seed mode)

# 看統計
curl http://localhost:8787/stats
# → {"total":15,"latest":"2026-09-14T...","categories":11}
```

### 測試 Cron 排程

`--test-scheduled` 會開放一個特殊路徑讓你模擬排程觸發：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

### 檢查本機資料庫內容

```bash
npx wrangler d1 execute cna --local --command="SELECT cat, title FROM seen LIMIT 5"
```

### 真的測試推播

把 `.dev.vars` 裡的 `SEED_ONLY` 改成 `0`，重啟 `npm run dev`，然後：

```bash
# 先清掉本機去重紀錄，讓它有東西可推
npx wrangler d1 execute cna --local --command="DELETE FROM seen"
curl http://localhost:8787/run
```

去頻道確認這幾項，確認完記得把 `SEED_ONLY` 改回 `1`：

- **標題整行可點**（藍色粗體），點下去進得了中央社原文
- **大圖預覽卡有出真實文章照片**（少數沒配圖的稿會退回中央社的通用圖，正常）
- **前言只出現一次**——在預覽卡裡。訊息本文只該有標題、發稿訊頭、出處三行
- 分類 emoji 對得上分類，沒有亂碼
- 發稿訊頭完整，沒有被截斷

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

**接下來等至少 12 分鐘**（11 個分類 × 每分鐘輪一個，讓每個分類都被掃過一遍）。

期間可以開著日誌觀察：

```bash
npm run tail
```

會看到類似輸出，每分鐘一則：

```
科技: parsed 15, sent 0 (seed mode)
生活: parsed 15, sent 0 (seed mode)
社會: parsed 15, sent 0 (seed mode)
```

12 分鐘後確認資料庫已灌種：

```bash
npm run db:count
```

應該看到 11 個分類、每個約 15 列：

```
┌──────┬────┐
│ cat  │ n  │
├──────┼────┤
│ 政治 │ 15 │
│ 國際 │ 15 │
│ ...  │ .. │
└──────┴────┘
```

---

## 步驟 10：正式上線

一樣不動 `wrangler.jsonc`，直接重新部署即可——不帶 `--var` 時就是設定檔裡的正式值 `"0"`：

```bash
npm run deploy
```

（想講得更明確也可以用 `npm run deploy:prod`，等同 `wrangler deploy --var SEED_ONLY:0`，結果一樣。）

從現在開始，只有**新發布**的稿件會被推送。開著日誌觀察前幾分鐘：

```bash
npm run tail
```

大約 10 分鐘內應該會看到第一則實際推播：

```
產經: parsed 15, sent 2
```

到頻道確認訊息正常後就完成了。

---

## 步驟 11：監控與維護

### 日常指令

```bash
npm run tail              # 即時日誌（Ctrl+C 離開）
npm run db:count          # 各分類累積推播數
npm run db:recent         # 最近 10 則（時間已轉台北時區）
npm run db:purge          # 清掉 90 天前的去重紀錄
```

### Dashboard 查看

Cloudflare Dashboard → **Workers & Pages** → 點選 `cna-telegram`：

- **Metrics** — 請求數、CPU time、錯誤率。**CPU time 的 P99 值是唯一要長期盯的指標**，接近 10 ms 就要警覺
- **Logs** — `console.log` 輸出（需要 `wrangler.jsonc` 裡 `observability.enabled` 為 `true`）
- **Settings → Triggers** — 確認 Cron 排程還在

### 重要提醒：Cron 失敗不會通知你

Cloudflare 不會在排程失敗時寄信或重試。如果 Worker 掛了，你只會發現「頻道好久沒更新」。

想要主動告警，最簡單的做法是另外做一個每日檢查：用手機的捷徑／自動化每天打一次 `https://你的worker網址/stats`，如果 `latest` 超過幾小時沒更新就提醒你。

### 更新程式碼

改完 `src/index.ts` 後：

```bash
npm run deploy
```

部署是原子的，不會有中斷。要回滾的話，Dashboard → **Deployments** 可以選舊版本。

### 手動觸發一輪（正式環境）

```bash
curl https://cna-telegram.<你的子網域>.workers.dev/run
```

> 這個端點是公開的。如果你在意有人亂打，可以在程式裡加一個簡單的 query token 檢查，或直接把 `/run` 那段拿掉，只留 `/stats`。

---

---

# 第二部分：完整檔案內容

## 檔案 1：`src/index.ts`

主程式。註解寫的是「為什麼這樣寫」，不只是「做了什麼」——特別是 `parseItems()` 為何用正則而非 XML 解析器、`RE_ITEM.lastIndex = 0` 為何必要、`clean()` 裡 `&amp;` 為何必須放最後、為何只取發稿訊頭而把前言交給連結預覽、`href` 為何一定要 `escapeHtml()`。這些是之後你自己改動時最容易踩到的地方。

訊息長這樣（標題整行是超連結，下面接大圖預覽卡）：

```
💻 泰國專家：AI治理與發展非二選一　應先釐清責任歸屬
（中央社記者李宗憲曼谷16日專電）
—— 中央通訊社 · 科技
```

分類 emoji 對照：🏛️ 政治／🌏 國際／🌊 兩岸／📈 產經／💻 科技／🌿 生活／🚨 社會／📍 地方／🎨 文化／🏅 運動／🎬 娛樂。建議在頻道也置頂一則對照表——11 個 emoji 讀者記不住，所以結尾那行的分類名稱**不要拿掉**，emoji 負責掃視、文字負責消歧義。

```typescript
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
```

---

## 檔案 2：`wrangler.jsonc`

**這是唯一必須修改的檔案** — `database_id` 要填入步驟 5 取得的值。

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
  // "* * * * *" = 每分鐘觸發一次
  // 11 個分類輪詢 → 每個分類約 11 分鐘掃一次
  // 免費方案每帳號最多 5 個 Cron Trigger，這裡只用 1 個
  "triggers": {
    "crons": ["* * * * *"],
  },

  // D1 資料庫綁定
  // binding       = 程式裡 env.DB 的名稱，不要改
  // database_name = 你執行 `wrangler d1 create cna` 時給的名稱
  // database_id   = 上述指令回傳的 UUID，請填進去
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cna",
      "database_id": "請填入 wrangler d1 create 回傳的 database_id",
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

```sql
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
```

---

## 檔案 4：`package.json`

`scripts` 區塊把常用指令包成捷徑，不用每次打一長串。

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
    "db:count": "wrangler d1 execute cna --remote --command=\"SELECT cat, COUNT(*) AS n FROM seen GROUP BY cat ORDER BY n DESC\"",
    "db:recent": "wrangler d1 execute cna --remote --command=\"SELECT datetime(ts/1000,'unixepoch','+8 hours') AS t, cat, title FROM seen ORDER BY ts DESC LIMIT 10\"",
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

> `db:recent` 裡的 `'+8 hours'` 是把 UTC 轉成台北時間。`db:purge` 的 `7776000` 是 90 天的秒數。

---

## 檔案 5：`tsconfig.json`

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

> `"types": ["@cloudflare/workers-types"]` 是關鍵，少了它編輯器會不認得 `D1Database`、`ScheduledController` 這些型別。注意這裡**沒有**引入 `dom` lib——Workers 不是瀏覽器環境，引入 `dom` 會讓你誤用不存在的 API。

---

## 檔案 6：`.gitignore`

```gitignore
node_modules/
.wrangler/
dist/

# 本機開發用的環境變數，絕對不要提交
.dev.vars
.env
```

---

## 檔案 7：`.dev.vars.example`

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
| `Error 1102 / exceededCpu`                                | 解析 XML 超過 10 ms CPU         | 把 `MAX_ITEMS` 從 15 降到 8；不行就升級 $5/月方案                   |
| `Error 1027`                                              | 超過每日 10 萬次請求            | 這個用途幾乎不可能發生，若發生請檢查是否有人在打你的 `/run` 端點    |
| `D1_ERROR: no such table: seen`                           | 忘記在正式資料庫建表            | `npx wrangler d1 execute cna --remote --file=./schema.sql`          |
| `Cannot read properties of undefined (reading 'prepare')` | `database_id` 沒填或填錯        | 檢查 `wrangler.jsonc`                                               |
| 訊息出現 `&amp;` 之類的字                                 | 實體字元處理順序問題            | 檢查 `clean()` 裡 `&amp;` 是否放在最後一個 replace                  |
| 訊息推了但格式跑掉                                        | 標題含 `<` `>` 等字元           | 確認 `escapeHtml()` 有被套用                                        |
| 完全沒有任何日誌                                          | Cron 沒生效                     | Dashboard → Settings → Triggers 確認；或 `wrangler deploy` 重新部署 |
| 頻道被洗版                                                | 忘記灌種                        | 刪除頻道訊息，`npm run deploy:seed` 重新灌種                        |
| 同一段前言出現兩次                                        | 本文又放了完整 `description`    | `parseItems()` 應只取 `RE_HEAD` 抽出的訊頭，前言交給預覽卡          |
| 沒有預覽卡，訊息只剩標題和訊頭                            | Telegram 抓不到中央社的 og tag  | 多半是暫時性（卡片有快取）；持續發生檢查 `link_preview_options.url` |
| 標題點不動                                                | 標題沒被 `<a>` 包住             | 檢查 `sendMessage()` 的 `text`，emoji 要在 `<a>` **外面**           |

---

## 額度用量估算

以每分鐘觸發、11 個分類、每天約 400 則新聞計算：

| 項目             | 預估用量        | 免費額度      | 佔比      |
| ---------------- | --------------- | ------------- | --------- |
| Workers 請求數   | 1,440 次／日    | 100,000／日   | 1.4%      |
| Workers CPU time | 約 3–6 ms／次   | 10 ms／次     | 30–60% ⚠️ |
| 外部 subrequest  | 1 + 最多 20／次 | 50／次        | 42%       |
| D1 rows written  | 約 400／日      | 100,000／日   | 0.4%      |
| D1 rows read     | 約 6,000／日    | 5,000,000／日 | 0.1%      |
| D1 儲存          | 每年約 5 MB     | 5 GB          | ~0%       |

**唯一需要盯的是 CPU time。** 其他項目距離上限都很遠。

> 上表的免費額度數字請自行複查 https://developers.cloudflare.com/workers/platform/limits/ 與 D1 定價頁。Cloudflare 會調整這些數字，我查證時也看到不同第三方來源互相矛盾（例如有來源寫「KV 每日 10 萬讀寫」、有的寫「讀 10 萬、寫 1 千」），請以官方文件為準。

---

## 附錄：用 Dashboard 圖形介面建立

如果你不想用命令列，也可以全程在網頁上操作，但**不推薦**——D1 綁定與程式碼編輯在網頁上很難管理，而且沒有版本控制。

大致流程：

1. Dashboard → **Workers & Pages** → **Create** → **Create Worker** → 命名 → **Deploy**
2. Dashboard → **Storage & Databases** → **D1** → **Create database** → 命名 `cna`
3. 在 D1 資料庫頁面的 **Console** 貼上 `schema.sql` 內容執行
4. 回到 Worker → **Settings** → **Bindings** → **Add** → **D1 database** → 變數名稱填 `DB`，選 `cna`
5. Worker → **Settings** → **Variables and Secrets** → 新增 `TG_TOKEN`（選 Secret 類型）、`TG_CHAT`、`SEED_ONLY`
6. Worker → **Settings** → **Triggers** → **Cron Triggers** → **Add** → 填 `* * * * *`
7. Worker → **Edit code** → 貼上 `src/index.ts` 內容 → **Deploy**

網頁編輯器不支援 TypeScript 型別檢查，貼進去前記得把型別註記處理好，或者直接改寫成 JavaScript。

---

## 延伸想法

做熟之後可以考慮：

- **關鍵字過濾**：只推含特定關鍵字的稿件，在 `run()` 的迴圈裡插一段 `if (!/關鍵字/.test(item.title)) continue;`
- **多頻道分流**：一個分類一個頻道，把 `TG_CHAT` 改成依分類查表
- **Bot 指令**：把 `fetch` handler 接成 Telegram webhook，支援 `/latest 科技` 這類查詢
- **去重強化**：中央社會更新稿件，如果想推「更新版」，可以改成比對標題變化
- **來源備援**：FeedBurner 是 Google 長期低度維護的服務，屬單點風險。程式裡已把 feed 網址抽成 `FEEDS` 常數，要換來源時只需改一處

---

## 授權

本指南與程式碼供個人使用。推播的新聞內容著作權屬中央通訊社所有，使用方式請遵守其 RSS 使用規範。
