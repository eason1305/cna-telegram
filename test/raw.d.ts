// Vite 的 ?raw 匯入：把檔案內容當字串載入，用來讀 fixtures 與 wrangler.jsonc
declare module "*?raw" {
  const content: string;
  export default content;
}
