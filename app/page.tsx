import { cookies } from "next/headers";
import { COOKIE_NAME, isConfigured, parseSession } from "@/lib/auth";
import Workspace from "@/components/workspace";
import { homeKey, isDirectFrontendMode, relayMode, serverApiOrigin } from "@/lib/relay-mode";
import { normalizeApiOrigin } from "@/lib/api-origin";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = relayMode();
  if (isDirectFrontendMode(mode)) {
    let apiOrigin = "";
    try { apiOrigin = normalizeApiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN || ""); } catch { /* Render a disabled gate when unconfigured. */ }
    // The Vercel frontend needs no password, signing key or cross-site cookie.
    return <Workspace initialAuthenticated={false} configured={!!apiOrigin} directBackend={mode === "cloudflare" ? "cloudflare" : "vps"} apiOrigin={apiOrigin} />;
  }
  if (mode === "worker") return <main className="fatal-page"><h1>Cloudflare API backend.</h1><p>Chạy backend bằng Wrangler, không phải Next.js. Dùng RELAY_MODE=cloudflare cho giao diện Vercel.</p></main>;
  if (mode === "server") {
    let message = "Oracle/VPS API đã sẵn sàng phía sau reverse proxy HTTPS.";
    try { serverApiOrigin(); } catch (error) { message = error instanceof Error ? error.message : "Backend chưa được cấu hình."; }
    if (!isConfigured()) message = "Kiểm tra ACCESS_PASSWORD không rỗng và AUTH_SECRET có ít nhất 32 ký tự trên server.";
    return <main className="fatal-page"><span className="eyebrow">RELAY / VPS API</span><h1>Backend Oracle VPS.</h1><p>{message}</p><p>Backend này không phục vụ giao diện đăng nhập. Mở website Vercel; các API yêu cầu origin được cho phép và bearer token.</p></main>;
  }
  if (mode === "home") {
    let message = "Backend đã sẵn sàng nhận request có khóa từ frontend.";
    try { homeKey(); } catch { message = "Chưa có HOME_BACKEND_KEY hợp lệ. Chạy npm run setup:home rồi khởi động lại."; }
    if (!isConfigured()) message = "Kiểm tra ACCESS_PASSWORD không rỗng và AUTH_SECRET có ít nhất 32 ký tự trong .env.local.";
    return <main className="fatal-page"><span className="eyebrow">RELAY / HOME BACKEND</span><h1>Backend tại nhà.</h1><p>{message}</p><p>Trang này không có form đăng nhập. Mở website Vercel để xem hoặc nghe; các API ở đây yêu cầu khóa kết nối riêng.</p></main>;
  }
  const jar = await cookies();
  return <Workspace initialAuthenticated={!!parseSession(jar.get(COOKIE_NAME)?.value)} configured={isConfigured()} viaHome={mode === "frontend"} />;
}
