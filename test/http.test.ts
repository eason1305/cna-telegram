import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("HTTP 端點", () => {
  it("未知路徑回 alive", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(await res.text()).toBe("alive");
  });

  it("/pick 拒絕未知的 src，包括原型屬性名稱", async () => {
    for (const src of ["nope", "toString"]) {
      const res = await SELF.fetch(`https://example.com/pick?src=${src}`);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(
        `unknown src: ${src}\n可用值: headlines, chart, world`,
      );
    }
  });

  it("/stats 統計推播數、卡住數與各來源", async () => {
    const latest = Date.UTC(2026, 8, 24);
    const ins = env.DB.prepare(
      "INSERT INTO picked (aid, source, slug, title, url, found_at, pushed_at, tries) VALUES (?, ?, 'aopl', 't', 'u', 0, ?, ?)",
    );
    await env.DB.batch([
      ins.bind("1", "headlines", latest, 0),
      ins.bind("2", "headlines", latest - 1, 0),
      ins.bind("3", "chart", latest - 2, 0),
      ins.bind("4", "world", null, 3), // stuck
      ins.bind("5", "world", null, 1),
    ]);

    const res = await SELF.fetch("https://example.com/stats");
    expect(await res.json()).toEqual({
      tracked: 5,
      pushed: 3,
      stuck: 1,
      latest: "2026-09-24T00:00:00.000Z",
      bySource: { headlines: 2, chart: 1 },
    });
  });

  it("/stats 在空表時回 0 與 null", async () => {
    const res = await SELF.fetch("https://example.com/stats");
    expect(await res.json()).toEqual({
      tracked: 0,
      pushed: 0,
      stuck: 0,
      latest: null,
      bySource: {},
    });
  });
});
