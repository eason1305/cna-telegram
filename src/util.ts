/** Promise 版的 setTimeout。等待時間不計入 Workers 的 CPU time */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 轉義成 Telegram HTML parse_mode 可以安全接受的文字 */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** D1 batch 結果裡實際寫入了幾列。搭配 INSERT OR IGNORE 就是「新增了幾則」 */
export const sumChanges = (results: D1Result[]): number =>
  results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
