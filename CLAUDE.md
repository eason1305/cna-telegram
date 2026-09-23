# CNA → Telegram 非官方推播

## 專案目標

Cloudflare Workers 定時抓中央社 RSS，推送到 Telegram 頻道。
完整規格見 @docs/spec.md，實作前請先讀。

## 硬性限制（違反會直接壞掉）

- Workers Free 每次 Cron 觸發只有 10ms CPU time。禁止引入 XML 解析函式庫。
- 每次觸發最多 50 個外部 subrequest。
- 去重必須用 D1 的 INSERT OR IGNORE，不可改成「先查再寫」三步驟。
- 只推標題、前言、連結。禁止抓全文（中央社 RSS 授權限制）。

## 禁止事項

- 不要把 TG_TOKEN / TG_CHAT 寫進任何檔案，一律用 wrangler secret put。
- 不要執行 wrangler deploy，部署由我手動確認後執行。
- 不要修改 .dev.vars。

## 常用指令

- npm test 單元與 D1 整合測試（離線，不碰 Telegram）
- npm run typecheck 型別檢查
- npm run dev 本機測試（含 --test-scheduled）
- npm run tail 即時日誌
- npm run db:count 各分類推播統計
