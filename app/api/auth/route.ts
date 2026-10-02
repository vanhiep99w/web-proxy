import { bearerSessionFromRequest, checkPassword, createSession, requireConfiguration, sealToken, sessionCookie, sessionFromRequest } from "@/lib/auth";
import { AppError, errorResponse, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/http";
import { consumeRateLimit, loginBucket } from "@/lib/rate-limit";
import { relayMode, requireBrowserMode } from "@/lib/relay-mode";
import { assertWorkerOrigin } from "@/lib/worker-cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireBrowserMode();
    requireConfiguration();
    if (relayMode() === "worker") {
      assertWorkerOrigin(request);
      return privateJson({ authenticated: !!bearerSessionFromRequest(request) });
    }
    return privateJson({ authenticated: !!sessionFromRequest(request) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireBrowserMode();
    if (relayMode() === "worker") assertWorkerOrigin(request);
    else assertSameOrigin(request);
    consumeRateLimit(loginBucket(request), 8, 60_000);
    const body = await readJson(request);
    if (!checkPassword(body.password)) throw new AppError("BAD_PASSWORD", "Mật khẩu chưa đúng. Hãy thử lại.", 401);
    const session = createSession();
    const token = sealToken("session", session);
    if (relayMode() === "worker") return privateJson({ authenticated: true, token, expiresAt: session.exp });
    const response = privateJson({ authenticated: true });
    response.headers.set("Set-Cookie", sessionCookie(token));
    return response;
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    requireBrowserMode();
    if (relayMode() === "worker") assertWorkerOrigin(request);
    else assertSameOrigin(request);
    const response = privateJson({ authenticated: false });
    if (relayMode() !== "worker") response.headers.set("Set-Cookie", sessionCookie("", 0));
    return response;
  } catch (error) { return errorResponse(error); }
}
