import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.error(".env.local đã tồn tại. Không ghi đè. Mở file này để xem/cập nhật cấu hình.");
  process.exit(1);
}
const password = randomBytes(18).toString("base64url");
const secret = randomBytes(32).toString("hex");
writeFileSync(".env.local", `ACCESS_PASSWORD=${password}\nAUTH_SECRET=${secret}\n`, { mode: 0o600, flag: "wx" });
console.log("Đã tạo .env.local với khóa ngẫu nhiên, chỉ đọc được bởi tài khoản hiện tại.");
console.log(`Mật khẩu local: ${password}`);
console.log("Chạy npm run dev, mở http://localhost:3000 và nhập mật khẩu trên.");
console.log("Khi deploy Vercel, sao chép 2 biến trong .env.local vào Settings → Environment Variables.");
console.log("Không commit, gửi kèm ảnh chụp hoặc chia sẻ file này.");
