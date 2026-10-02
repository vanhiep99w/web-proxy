import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env");
// This utility always edits .env.local, including when invoked by a test runner.
process.env.NODE_ENV = "development";
loadEnvConfig(process.cwd(), true);
const path = ".env.local";
let content = existsSync(path) ? readFileSync(path, "utf8") : "";
const updates = [];
for (const [key, generate] of [
  ["ACCESS_PASSWORD", () => randomBytes(18).toString("base64url")],
  ["AUTH_SECRET", () => randomBytes(32).toString("hex")],
  ["HOME_BACKEND_KEY", () => randomBytes(32).toString("hex")],
]) {
  const current = process.env[key];
  if (current) {
    if (key !== "ACCESS_PASSWORD" && current.length < 32) {
      console.error(`${key} hiện quá ngắn. Hãy sửa thủ công; script không ghi đè khóa đã đặt.`);
      process.exit(1);
    }
    continue;
  }
  const expression = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "m");
  const replacement = `${key}=${generate()}`;
  content = expression.test(content) ? content.replace(expression, () => replacement) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${replacement}\n`;
  updates.push(key);
}
if (updates.length) writeFileSync(path, content, { mode: 0o600 });
if (existsSync(path)) chmodSync(path, 0o600);
console.log(updates.length ? `Đã bổ sung ${updates.join(", ")} vào .env.local.` : "Các khóa đã tồn tại; giữ nguyên, không ghi đè.");
console.log("Không thay đổi mật khẩu / AUTH_SECRET đã có, không đổi RELAY_MODE.");
console.log("Chạy npm run dev:home (local:3001) hoặc npm run build && npm run start:home.");
console.log("Xem HOME_BACKEND_KEY trong .env.local và đặt cùng giá trị trên Vercel; không chia sẻ / commit khóa.");
