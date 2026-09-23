import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAP_MS, MAX_SEND, SOURCES, WAIT_MS } from "../src/config";
import { discover, drain } from "../src/picks";
import { scan } from "../src/scan";
import type { Env } from "../src/types";
import headlines from "./fixtures/headlines.html?raw";
import rss from "./fixtures/rss.xml?raw";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * drain 每送一則會真的 sleep GAP_MS。用假的 setTimeout 跳過，同時不斷讓出事件迴圈給 D1 I/O。
 * （vi.mock 在這個 pool 裡只替換測試自己的 import，攔不到 picks.ts 裡的 sleep，所以走假計時器。）
 */
async function runDrain(e: Env = env): Promise<string> {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let done = false;
  const result = drain(e).finally(() => {
    done = true;
  });
  while (!done) {
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await scheduler.wait(1);
  }
  return result;
}

/** 攔截所有對外請求：Telegram 一律成功，其他網址回 pages 裡對應的內容 */
function mockFetch(pages: Record<string, string | Response> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) return new Response("{}");
    const page = pages[url];
    if (page === undefined) throw new Error(`unexpected fetch: ${url}`);
    return typeof page === "string" ? new Response(page) : page;
  });
}

/** 從 fetch mock 取出送到 Telegram 的訊息本文 */
const sentTexts = (fetch: ReturnType<typeof mockFetch>): string[] =>
  fetch.mock.calls
    .filter(([url]) => String(url).startsWith("https://api.telegram.org/"))
    .map(([, init]) => JSON.parse(init!.body as string).text as string);

type PickedRow = {
  aid: string;
  source?: string;
  slug?: string;
  title?: string;
  pub_at?: number | null;
  found_at?: number;
  tries?: number;
};

async function insertPicked(...rows: PickedRow[]) {
  const stmt = env.DB.prepare(
    "INSERT INTO picked (aid, source, slug, title, url, pub_at, found_at, tries) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  await env.DB.batch(
    rows.map((r) => {
      const slug = r.slug ?? "aopl";
      return stmt.bind(
        r.aid,
        r.source ?? "headlines",
        slug,
        r.title ?? `清單標題 ${r.aid}`,
        `https://www.cna.com.tw/news/${slug}/${r.aid}.aspx`,
        r.pub_at === undefined ? Date.now() - WAIT_MS * 2 : r.pub_at,
        r.found_at ?? 1,
        r.tries ?? 0,
      );
    }),
  );
}

async function insertSeen(aid: string, title: string, head: string) {
  await env.DB.prepare(
    "INSERT INTO seen (guid, aid, cat, title, link, head, ts) VALUES (?, ?, '國際', ?, '', ?, 0)",
  )
    .bind(`CNA/x/${aid}`, aid, title, head)
    .run();
}

const pushedAids = async (): Promise<string[]> =>
  (
    await env.DB.prepare(
      "SELECT aid FROM picked WHERE pushed_at IS NOT NULL ORDER BY aid",
    ).all<{ aid: string }>()
  ).results.map((r) => r.aid);

describe("scan", () => {
  it("依分鐘數輪詢分類，寫進 seen，重複掃描不重複寫入", async () => {
    vi.spyOn(Date, "now").mockReturnValue(60_000); // 第 1 分鐘 → FEEDS[1] = 國際
    mockFetch({ "https://feeds.feedburner.com/rsscna/intworld": rss });

    expect(await scan(env)).toBe("國際: parsed 4, new 4");
    expect(await scan(env)).toBe("國際: parsed 4, new 0");

    const row = await env.DB.prepare(
      "SELECT aid, cat, head FROM seen WHERE aid = '202609240002'",
    ).first();
    expect(row).toEqual({
      aid: "202609240002",
      cat: "國際",
      head: "（中央社紐約聯合國總部23日綜合外電報導）",
    });
  });

  it("feed 錯誤或解析不到東西時回報，不寫入", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0); // FEEDS[0] = 政治
    mockFetch({
      "https://feeds.feedburner.com/rsscna/politics": new Response("", {
        status: 503,
      }),
    });
    expect(await scan(env)).toBe("政治: feed error 503");

    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(0);
    mockFetch({ "https://feeds.feedburner.com/rsscna/politics": "<rss/>" });
    expect(await scan(env)).toBe("政治: parsed 0");
  });
});

describe("discover", () => {
  it("記進 picked 但不推播，重複執行不重複記錄", async () => {
    const fetch = mockFetch({ [SOURCES.headlines.url]: headlines });

    expect(await discover(env, "headlines")).toBe("headlines: parsed 4, new 4");
    expect(await discover(env, "headlines")).toBe("headlines: parsed 4, new 0");
    expect(sentTexts(fetch)).toEqual([]);
    expect(await pushedAids()).toEqual([]);
  });

  it("跨清單去重：先看到的來源保留", async () => {
    await insertPicked({ aid: "202609230359", source: "chart" });
    mockFetch({ [SOURCES.headlines.url]: headlines });

    expect(await discover(env, "headlines")).toBe("headlines: parsed 4, new 3");
    const row = await env.DB.prepare(
      "SELECT source FROM picked WHERE aid = '202609230359'",
    ).first();
    expect(row).toEqual({ source: "chart" });
  });

  it("灌種模式直接標記為已推", async () => {
    mockFetch({ [SOURCES.headlines.url]: headlines });
    expect(await discover({ ...env, SEED_ONLY: "1" }, "headlines")).toBe(
      "headlines: parsed 4, new 4 (seed mode)",
    );
    expect(await pushedAids()).toHaveLength(4);
  });

  it("頁面錯誤與結構變更都回報", async () => {
    mockFetch({ [SOURCES.chart.url]: new Response("", { status: 500 }) });
    expect(await discover(env, "chart")).toBe("chart: page error 500");

    vi.restoreAllMocks();
    mockFetch({ [SOURCES.chart.url]: "<html>改版了</html>" });
    expect(await discover(env, "chart")).toBe(
      "chart: parsed 0 (structure changed?)",
    );
  });
});

describe("drain", () => {
  it("灌種模式不查也不送", async () => {
    const fetch = mockFetch();
    expect(await runDrain({ ...env, SEED_ONLY: "1" })).toBe(
      "drain: skipped (seed mode)",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("送出後標記 pushed_at；標題優先用 RSS、依 slug 還原分類、帶來源 tag", async () => {
    await insertPicked({
      aid: "202609240002",
      slug: "aopl",
      source: "world",
      title: "清單上的標題",
    });
    await insertSeen("202609240002", "RSS 的標題", "（中央社紐約23日電）");
    const fetch = mockFetch();

    expect(await runDrain(env)).toBe("drain: sent 1");
    expect(sentTexts(fetch)).toEqual([
      '🌏 <a href="https://www.cna.com.tw/news/aopl/202609240002.aspx"><b>RSS 的標題</b></a>\n' +
        "（中央社紐約23日電）\n" +
        "—— 中央通訊社 · 國際 · 🌍 特派看世界",
    ]);
    expect(await pushedAids()).toEqual(["202609240002"]);
    expect(await runDrain(env)).toBe("drain: sent 0");
  });

  it("未知的 slug 與 source 退回預設值", async () => {
    await insertPicked({ aid: "202609240002", slug: "axyz", source: "???" });
    const fetch = mockFetch();

    await runDrain(env);
    expect(sentTexts(fetch)[0]).toMatch(/^📰 .*\n—— 中央通訊社 · 新聞$/);
  });

  it("即時新聞沒訊頭且還新鮮時等 RSS；過了等待時間、沒有發布時間、或是特稿就直接送", async () => {
    const now = Date.now();
    await insertPicked(
      { aid: "202609240001", pub_at: now - 60_000 }, // 新鮮 → 等
      { aid: "202609240002", pub_at: now - WAIT_MS - 60_000 }, // 等夠了
      { aid: "202609240003", pub_at: null }, // 不知道何時發布 → 不等
      { aid: "202609243001", pub_at: now - 60_000 }, // 特稿永遠不進 RSS → 不等
    );
    mockFetch();

    expect(await runDrain(env)).toBe("drain: sent 3, waiting 1");
    expect(await pushedAids()).toEqual([
      "202609240002",
      "202609240003",
      "202609243001",
    ]);
  });

  it("送出失敗時 tries + 1 並停下，不繼續送後面的", async () => {
    await insertPicked({ aid: "202609240001" }, { aid: "202609240002" });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));

    expect(await runDrain(env)).toBe("drain: sent 0");
    expect(fetch).toHaveBeenCalledOnce();
    const rows = await env.DB.prepare(
      "SELECT aid, tries, pushed_at FROM picked ORDER BY aid",
    ).all();
    expect(rows.results).toEqual([
      { aid: "202609240001", tries: 1, pushed_at: null },
      { aid: "202609240002", tries: 0, pushed_at: null },
    ]);
  });

  it("排序：tries 少的優先，其次 found_at，再其次 pub_at", async () => {
    const old = Date.now() - WAIT_MS * 2;
    await insertPicked(
      { aid: "202609240001", tries: 1, found_at: 1 },
      { aid: "202609240002", found_at: 2, pub_at: old + 2 },
      { aid: "202609240003", found_at: 2, pub_at: old + 1 },
      { aid: "202609240004", found_at: 3 },
    );
    const fetch = mockFetch();

    await runDrain(env);
    expect(
      sentTexts(fetch).map((t) => t.match(/\/(\d{12})\.aspx/)![1]),
    ).toEqual(["202609240003", "202609240002", "202609240004", "202609240001"]);
  });

  it(`每輪最多送 ${MAX_SEND} 則`, async () => {
    await insertPicked(
      ...Array.from({ length: MAX_SEND + 1 }, (_, i) => ({
        aid: `2026092400${String(i).padStart(2, "0")}`,
        found_at: i,
      })),
    );
    mockFetch();

    expect(await runDrain(env)).toBe(`drain: sent ${MAX_SEND}`);
  });
});
