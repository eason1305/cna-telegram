import type { Env as WorkerEnv } from "../src/index";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** vitest.config.mts 從 schema.sql 切出來的建表語句 */
      TEST_SCHEMA: string[];
    }
  }
}
