import { env } from "cloudflare:test";
import { beforeEach } from "vitest";

// 每個測試都從空表開始，避免彼此的 INSERT OR IGNORE 互相干擾
beforeEach(async () => {
  await env.DB.batch(env.TEST_SCHEMA.map((sql) => env.DB.prepare(sql)));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM seen"),
    env.DB.prepare("DELETE FROM picked"),
  ]);
});
