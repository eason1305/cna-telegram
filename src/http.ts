import { isSourceKey, SOURCES } from "./config";
import { discover, drain } from "./picks";
import { scan } from "./scan";
import type { Env } from "./types";

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

/** HTTP 入口：手動觸發與健康檢查 */
export async function handleFetch(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/run") {
    return new Response(await scan(env), { headers: TEXT_HEADERS });
  }

  // 只抓清單頁記進 picked，不推播——推播一律走 /push，與 Cron 的分工一致
  if (url.pathname === "/pick") {
    const src = url.searchParams.get("src") ?? "headlines";
    if (!isSourceKey(src)) {
      return new Response(
        `unknown src: ${src}\n可用值: ${Object.keys(SOURCES).join(", ")}`,
        { status: 400, headers: TEXT_HEADERS },
      );
    }
    return new Response(await discover(env, src), {
      headers: TEXT_HEADERS,
    });
  }

  // 手動推播。注意：每 5 分鐘的 Cron 也會 drain，兩者同時跑就會重複推播，
  // 所以這個端點只適合在本機或確定 Cron 沒在跑的時候用。
  if (url.pathname === "/push") {
    return new Response(await drain(env), { headers: TEXT_HEADERS });
  }

  if (url.pathname === "/stats") {
    // stuck = 還沒推出去而且已經失敗三次以上的。因為不設放棄門檻，
    // 這種項目會一直留在隊尾重試，只能靠這個數字看見它們的存在。
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS tracked,
              SUM(CASE WHEN pushed_at IS NOT NULL THEN 1 ELSE 0 END) AS pushed,
              SUM(CASE WHEN pushed_at IS NULL AND tries >= 3 THEN 1 ELSE 0 END) AS stuck,
              MAX(pushed_at) AS latest
         FROM picked`,
    ).first<{
      tracked: number;
      pushed: number | null;
      stuck: number | null;
      latest: number | null;
    }>();
    const bySource = await env.DB.prepare(
      "SELECT source, COUNT(*) AS n FROM picked WHERE pushed_at IS NOT NULL GROUP BY source",
    ).all<{ source: string; n: number }>();

    return Response.json({
      tracked: row?.tracked ?? 0,
      pushed: row?.pushed ?? 0,
      stuck: row?.stuck ?? 0,
      latest: row?.latest ? new Date(row.latest).toISOString() : null,
      bySource: Object.fromEntries(
        bySource.results.map((r) => [r.source, r.n]),
      ),
    });
  }

  return new Response("alive", { headers: TEXT_HEADERS });
}
