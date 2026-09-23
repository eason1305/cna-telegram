import type { Env, Outgoing } from "./types";
import { escapeHtml, sleep } from "./util";

/** 遇到 429 時最多重試幾次 */
const MAX_RETRIES = 2;

/**
 * 組出訊息本文（Telegram HTML parse_mode）。
 *
 * head 可能是空字串：特稿系列不進 RSS，永遠抽不到訊頭。這種情況只是少一行，
 * 預覽卡片仍會從 og tag 帶回摘要與首圖，訊息依然完整可讀。
 */
export function formatMessage(msg: Outgoing): string {
  // emoji 放在 <a> 外面：它不是中央社標題的一部分，包進去會被染成連結色，
  // 也會讓「哪幾個字是標題」變模糊。
  // href 一定要 escape——clean() 會把 &amp; 還原成裸 &，真的出現在網址裡會讓
  // Telegram 的 HTML 解析爛掉。目前中央社的 link 都沒有 query string，但這是零成本的保險。
  // 結尾的「中央通訊社」不能省：授權條款要求以文字標示，訊頭寫的是「中央社」不算數。
  return (
    `${msg.emoji} <a href="${escapeHtml(msg.link)}"><b>${escapeHtml(msg.title)}</b></a>\n` +
    (msg.head ? `${escapeHtml(msg.head)}\n` : "") +
    `—— 中央通訊社 · ${msg.category}${msg.tag ? ` · ${msg.tag}` : ""}`
  );
}

/**
 * 送出一則訊息。遇到 429（速率限制）會依 Telegram 指示的秒數退避後重試，最多兩次。
 * 其他錯誤（或重試用完仍是 429）直接拋出，由呼叫端決定要不要停。
 */
export async function sendMessage(env: Env, msg: Outgoing): Promise<void> {
  const body = JSON.stringify({
    chat_id: env.TG_CHAT,
    text: formatMessage(msg),
    parse_mode: "HTML",
    // 顯式指定 url，不依賴「訊息文字裡的第一個網址」那套 fallback。
    // 預覽卡片負責呈現首圖與前言，這兩樣都是 RSS 授權明列可用的項目，
    // 而且是 Telegram 直接讀中央社自己的 og tag，不經過我們轉手。
    link_preview_options: {
      url: msg.link,
      prefer_large_media: true,
    },
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    );

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const data = (await res.json()) as {
        parameters?: { retry_after?: number };
      };
      const wait = (data.parameters?.retry_after ?? 5) + 1;
      console.log(`429 rate limited, retry after ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`telegram ${res.status}: ${await res.text()}`);
    }
    return;
  }
}
