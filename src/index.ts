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

import { CRON_JOBS, SCAN_CRON } from "./config";
import { handleFetch } from "./http";
import { discover, drain } from "./picks";
import { scan } from "./scan";
import type { Env } from "./types";

export type { Env } from "./types";

export default {
  /** Cron 排程觸發 */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const job = CRON_JOBS[controller.cron];

    // 排程字串必須與 wrangler.jsonc 逐字一致。對不上的話這裡會靜默退回 scan()，
    // 那份清單就永遠不會被抓而且不會報錯——所以對不上就要留下紀錄。
    if (!job && controller.cron !== SCAN_CRON) {
      console.error(
        `unknown cron "${controller.cron}" — 與 CRON_JOBS 對不上，這次當成 scan 處理`,
      );
    }

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

  /** HTTP 入口：手動觸發與健康檢查，路由見 http.ts */
  fetch: handleFetch,
} satisfies ExportedHandler<Env>;
