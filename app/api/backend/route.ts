import { requireSession } from "@/lib/auth";
import { errorResponse, privateJson } from "@/lib/errors";
import { forwardHome } from "@/lib/home-proxy";
import { consumeRateLimit } from "@/lib/rate-limit";
import { apiSession, isDirectBackendMode, playbackOrigin, relayMode, requireBrowserMode, requireHomeKey } from "@/lib/relay-mode";
import { serverPreflight, withServerCors } from "@/lib/server-cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

async function getBackend(request: Request) {
  try {
    const mode = relayMode();
    if (mode === "home") {
      requireHomeKey(request);
      return privateJson({ connected: true, mode: "home", serverTime: new Date().toISOString() });
    }
    requireBrowserMode();
    const direct = isDirectBackendMode(mode);
    const session = direct ? apiSession(request) : requireSession(request);
    consumeRateLimit(`health:${session.sid}`, 10, 60_000);
    if (mode === "frontend") return await forwardHome(request, "backend", session);
    if (mode === "server") playbackOrigin(request); // Fail closed when API_ORIGIN is missing or invalid.
    return privateJson({ connected: true, mode: mode === "worker" ? "cloudflare" : mode === "server" ? "vps" : "standalone" });
  } catch (error) { return errorResponse(error); }
}

export const GET = (request: Request) => withServerCors(request, () => getBackend(request));
export const OPTIONS = (request: Request) => serverPreflight(request, ["GET"]);
