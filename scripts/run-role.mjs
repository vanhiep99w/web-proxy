import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [mode, command = "dev", ...args] = process.argv.slice(2);
if (!["home", "frontend", "cloudflare"].includes(mode) || !["dev", "start"].includes(command)) {
  console.error("Usage: node scripts/run-role.mjs home|frontend|cloudflare dev|start");
  process.exit(1);
}
const port = mode === "home" ? "3001" : mode === "cloudflare" ? "3000" : "3002";
const env = { ...process.env, RELAY_MODE: mode };
if (mode === "cloudflare") env.NEXT_PUBLIC_API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN || "http://127.0.0.1:8787";
if (command === "dev") env.RELAY_DEV_DIST_DIR = `.next/${mode}-dev`;
else delete env.RELAY_DEV_DIST_DIR;
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), command, "--hostname", "127.0.0.1", "--port", port, ...args], { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", () => { console.error("Không khởi động được Next.js."); process.exit(1); });
