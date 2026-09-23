import { describe, expect, it } from "vitest";
import {
  CRON_JOBS,
  FEEDS,
  isSourceKey,
  SCAN_CRON,
  SOURCES,
} from "../src/config";
import { isFeature } from "../src/parse";
import wrangler from "../wrangler.jsonc?raw";

/** wrangler.jsonc 的 crons 陣列。只取這一段，不必為了整份 JSONC 引入解析器 */
const crons = JSON.parse(
  wrangler.match(/"crons":\s*(\[[^\]]*\])/)![1].replace(/,\s*\]/, "]"),
) as string[];

describe("Cron 排程", () => {
  it("wrangler.jsonc 與 CRON_JOBS + SCAN_CRON 逐字一致", () => {
    expect([...crons].sort()).toEqual(
      [...Object.keys(CRON_JOBS), SCAN_CRON].sort(),
    );
  });

  it("只有一條會 drain", () => {
    expect(Object.values(CRON_JOBS).filter((j) => j.drain)).toHaveLength(1);
  });

  it("星期欄位不用數字（Cloudflare 的 1 = 週日，與一般 cron 不同）", () => {
    for (const cron of crons) {
      expect(cron.split(" ")[4]).toMatch(/^(\*|[A-Z]{3}(-[A-Z]{3})?)$/);
    }
  });
});

describe("FEEDS", () => {
  it("slug 與 urlSlug 都不重複", () => {
    expect(new Set(FEEDS.map((f) => f.slug)).size).toBe(FEEDS.length);
    expect(new Set(FEEDS.map((f) => f.urlSlug)).size).toBe(FEEDS.length);
  });
});

describe("isSourceKey", () => {
  it("接受三份清單，拒絕原型屬性", () => {
    for (const key of Object.keys(SOURCES)) expect(isSourceKey(key)).toBe(true);
    expect(isSourceKey("toString")).toBe(false);
    expect(isSourceKey("constructor")).toBe(false);
    expect(isSourceKey("")).toBe(false);
  });
});

describe("isFeature", () => {
  it("流水號 3000 以上是特稿", () => {
    expect(isFeature("202609232999")).toBe(false);
    expect(isFeature("202609233000")).toBe(true);
    expect(isFeature("202609230001")).toBe(false);
  });
});
