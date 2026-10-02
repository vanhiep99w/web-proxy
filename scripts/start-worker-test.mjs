import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";
import { workerTest } from "./worker-test-settings.mjs";

// Serve the production bundle in workerd, with offline upstream fixtures only.
const root = resolve(".wrangler/e2e-worker");
execFileSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--outdir", root], {
  env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" }, stdio: "pipe",
});
const runtime = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1", port: 3104,
  modules: [
    { type: "ESModule", path: resolve(root, "index.js") },
    ...readdirSync(root).filter((file) => file.endsWith(".wasm")).map((file) => ({ type: "CompiledWasm", path: resolve(root, file) })),
  ],
  modulesRoot: root,
  compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"],
  bindings: { RELAY_MODE: "worker", ACCESS_PASSWORD: workerTest.password, AUTH_SECRET: workerTest.secret, FRONTEND_ORIGINS: workerTest.frontendOrigin },
  ratelimits: { LOGIN_RATE_LIMITER: { namespace_id: "1001", simple: { limit: 100, period: 60 } } },
  outboundService: async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "i.ytimg.com") return new Response("jpg", { headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } });
    if (url.hostname.endsWith(".googlevideo.com") && url.pathname === "/videoplayback") {
      const match = url.searchParams.get("range")?.match(/^(\d+)-(\d+)$/);
      if (!match) throw new Error("Missing upstream range");
      const start = Number(match[1]), end = Number(match[2]);
      const body = new Uint8Array(end - start + 1);
      return new Response(body, { status: 206, headers: { "Content-Length": String(body.byteLength), "Content-Range": `bytes ${start}-${end}/100` } });
    }
    throw new Error("E2E cannot contact a real upstream");
  },
}));
await runtime.ready;
console.log("Test Worker ready on " + workerTest.apiOrigin);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await runtime.dispose(); process.exit(0); });
