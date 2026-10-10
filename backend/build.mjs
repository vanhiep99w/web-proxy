import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["backend/main.ts"],
  outfile: "backend/dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["youtubei.js", "quickjs-emscripten"],
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
