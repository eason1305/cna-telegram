import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("health check responds", async () => {
  const res = await SELF.fetch("https://example.com/");
  expect(await res.text()).toBe("alive");
});

it("schema is applied", async () => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM picked").first<{
    n: number;
  }>();
  expect(row?.n).toBe(0);
});
