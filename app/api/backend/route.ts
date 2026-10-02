import { requireSession } from "@/lib/auth";
import { errorResponse, privateJson } from "@/lib/errors";
import { forwardHome } from "@/lib/home-proxy";
import { consumeRateLimit } from "@/lib/rate-limit";
import { apiSession, relayMode, requireBrowserMode, requireHomeKey } from "@/lib/relay-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  try {
    const mode = relayMode();
    if (mode === "home") {
      requireHomeKey(request);
      return privateJson({ connected: true, mode: "home", serverTime: new Date().toISOString() });
    }
    requireBrowserMode();
    const session = mode === "worker" ? apiSession(request) : requireSession(request);
    consumeRateLimit(`health:${session.sid}`, 10, 60_000);
    if (mode === "frontend") return await forwardHome(request, "backend", session);
    return privateJson({ connected: true, mode: mode === "worker" ? "cloudflare" : "standalone" });
  } catch (error) { return errorResponse(error); }
}
