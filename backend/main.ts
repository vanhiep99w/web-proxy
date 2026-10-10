import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./server";
import { requireConfiguration } from "@/lib/auth";
import { serverApiOrigin } from "@/lib/relay-mode";
import { frontendOrigins } from "@/lib/worker-cors";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/logging";

// Platform environment wins. Load local files without exposing their contents.
for (const relative of ["../.env.local", "../.env", "../../.env.local", "../../.env"]) {
  const file = fileURLToPath(new URL(relative, import.meta.url));
  if (existsSync(file)) loadEnvFile(file);
}
process.env.RELAY_MODE ||= "server";
const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
try {
  requireConfiguration();
  serverApiOrigin();
  frontendOrigins();
  const rawPort = option("--port") ?? process.env.SERVER_PORT ?? process.env.PORT ?? "3001";
  const hostname = option("--hostname") ?? process.env.RELAY_BIND_HOST ?? "0.0.0.0";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535 || !["0.0.0.0", "127.0.0.1"].includes(hostname)) {
    throw new AppError("INVALID_LISTEN_CONFIG", "Port hoặc hostname không hợp lệ.", 503);
  }
  const port = Number(rawPort);
  const server = createApiServer();
  server.on("error", () => {
    logEvent("server.error", { code: "LISTEN_FAILED", port, hostname });
    process.exitCode = 1;
  });
  server.listen(port, hostname, () => logEvent("server.ready", { port, hostname, node: process.version }));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    logEvent("server.stopping");
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10_000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  logEvent("server.startup_failed", { code: error instanceof AppError ? error.code : "STARTUP_ERROR" });
  process.exitCode = 1;
}
