import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMessage, sendMessage } from "../src/telegram";
import type { Outgoing } from "../src/types";

const msg: Outgoing = {
  emoji: "🌏",
  title: "伊朗總統聯大發表強硬演說",
  link: "https://www.cna.com.tw/news/aopl/202609240002.aspx",
  head: "（中央社紐約聯合國總部23日綜合外電報導）",
  category: "國際",
  tag: "",
};

describe("formatMessage", () => {
  it("標題連結、訊頭、出處三行", () => {
    expect(formatMessage(msg)).toBe(
      '🌏 <a href="https://www.cna.com.tw/news/aopl/202609240002.aspx"><b>伊朗總統聯大發表強硬演說</b></a>\n' +
        "（中央社紐約聯合國總部23日綜合外電報導）\n" +
        "—— 中央通訊社 · 國際",
    );
  });

  it("沒有訊頭就少一行；有 tag 接在分類後面", () => {
    expect(formatMessage({ ...msg, head: "", tag: "🌍 特派看世界" })).toBe(
      '🌏 <a href="https://www.cna.com.tw/news/aopl/202609240002.aspx"><b>伊朗總統聯大發表強硬演說</b></a>\n' +
        "—— 中央通訊社 · 國際 · 🌍 特派看世界",
    );
  });

  it("標題、網址、訊頭都會 escape", () => {
    const text = formatMessage({
      ...msg,
      title: "A&B <C>",
      link: "https://example.com/?a=1&b=2",
      head: "（中央社<x>）",
    });
    expect(text).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(text).toContain("<b>A&amp;B &lt;C&gt;</b>");
    expect(text).toContain("（中央社&lt;x&gt;）");
  });
});

describe("sendMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("送出的 payload 帶 HTML parse_mode 與預覽網址", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    await sendMessage(env, msg);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(init!.body as string)).toEqual({
      chat_id: "@test",
      text: formatMessage(msg),
      parse_mode: "HTML",
      link_preview_options: { url: msg.link, prefer_large_media: true },
    });
  });

  it("429 依 retry_after 退避後重試，成功就結束", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ parameters: { retry_after: 3 } }, { status: 429 }),
      )
      .mockResolvedValueOnce(new Response("{}"));

    const done = sendMessage(env, msg);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetch).toHaveBeenCalledTimes(1); // retry_after + 1 秒之前不重試
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("連續 429 最多重試兩次，第三次直接拋錯", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ parameters: { retry_after: 1 } }, { status: 429 }),
      );

    const done = sendMessage(env, msg);
    const assertion = expect(done).rejects.toThrow(/^telegram 429/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("其他錯誤不重試，直接拋出", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Bad Request", { status: 400 }));
    await expect(sendMessage(env, msg)).rejects.toThrow(
      "telegram 400: Bad Request",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
