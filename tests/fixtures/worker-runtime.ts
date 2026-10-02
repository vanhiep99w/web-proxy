// Test entrypoint ONLY. wrangler.jsonc deploys cloudflare/index.ts, not this file.
import worker, { type WorkerEnv } from "../../cloudflare/index";
import { evaluatePlayer } from "../../cloudflare/evaluator";
import { Platform } from "youtubei.js";
import { readJson } from "../../lib/http";

const fixture = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/__test/evaluate" && request.method === "POST") {
      const body = await readJson(request);
      try { return Response.json({ result: await evaluatePlayer(String(body.code)) }); }
      catch { return Response.json({ error: "Sandbox rejected code" }, { status: 422 }); }
    }
    if (path === "/__test/platform") return Response.json({ runtime: Platform.shim.runtime });
    return worker.fetch(request, env);
  },
};
export default fixture;
