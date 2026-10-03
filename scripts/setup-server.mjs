import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [apiValue, frontendValue] = process.argv.slice(2);
if (!apiValue || !frontendValue) {
  console.error("Usage: npm run setup:server -- https://api.example.com https://frontend.vercel.app");
  process.exit(1);
}
if (existsSync(".env.local")) {
  console.error(".env.local đã tồn tại. Không ghi đè; hãy sửa file hiện tại bằng tay nếu cần.");
  process.exit(1);
}
function httpsOrigin(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[*;,\s]/.test(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    console.error(`${name} phải là origin HTTPS chính xác, không có path/query/wildcard.`);
    process.exit(1);
  }
}
const apiOrigin = httpsOrigin(apiValue, "API origin");
const frontendEntries = frontendValue.split(",").map((entry) => entry.trim());
if (!frontendEntries.length || frontendEntries.length > 16 || frontendEntries.some((entry) => !entry)) {
  console.error("Frontend origins không hợp lệ.");
  process.exit(1);
}
const frontendOrigins = [...new Set(frontendEntries.map((entry) => httpsOrigin(entry, "Frontend origin")))].join(",");
const password = randomBytes(18).toString("base64url");
const secret = randomBytes(32).toString("hex");
writeFileSync(".env.local", [
  "RELAY_MODE=server",
  `API_ORIGIN=${apiOrigin}`,
  `FRONTEND_ORIGINS=${frontendOrigins}`,
  `ACCESS_PASSWORD=${password}`,
  `AUTH_SECRET=${secret}`,
  "",
].join("\n"), { mode: 0o600, flag: "wx" });
console.log("Đã tạo .env.local cho Oracle/VPS với quyền 0600.");
console.log(`Mật khẩu truy cập mới: ${password}`);
console.log("Lưu mật khẩu vào trình quản lý mật khẩu. Không gửi .env.local, AUTH_SECRET hoặc mật khẩu lên Git.");
console.log("Tiếp theo: npm run build:server && npm run start:server");
