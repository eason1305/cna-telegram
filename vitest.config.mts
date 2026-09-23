import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * 把 schema.sql 切成單句交給測試環境建表。
 * D1 的 exec() 對多行語句與註解很挑，逐句 prepare 再 batch 最穩。
 */
const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8")
  .replace(/--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // 明確覆蓋成假值：就算日後有人建了 .dev.vars，測試也不會拿真 token 打 Telegram
        bindings: {
          TG_TOKEN: "test-token",
          TG_CHAT: "@test",
          SEED_ONLY: "0",
          TEST_SCHEMA: schema,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
