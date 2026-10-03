import { bearerSessionFromRequest, checkPassword, createSession, requireConfiguration, sealToken, sessionCookie, sessionFromRequest } from "@/lib/auth";
import { AppError, errorResponse, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/http";
import { consumeRateLimit, loginBucket } from "@/lib/rate-limit";
import { isDirectBackendMode, relayMode, requireBrowserMode, serverApiOrigin } from "@/lib/relay-mode";
import { serverPreflight, withServerCors } from "@/lib/server-cors";
import { assertDirectOrigin } from "@/lib/worker-cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAuth(request: Request) {
  try {
    requireBrowserMode();
    const mode = relayMode();
    if (isDirectBackendMode(mode)) {
      assertDirectOrigin(request);
      if (mode === "server") serverApiOrigin();
      requireConfiguration();
      return privateJson({ authenticated: !!bearerSessionFromRequest(request) });
    }
    requireConfiguration();
    return privateJson({ authenticated: !!sessionFromRequest(request) });
  } catch (error) { return errorResponse(error); }
}

async function postAuth(request: Request) {
  try {
    requireBrowserMode();
    const mode = relayMode();
    const direct = isDirectBackendMode(mode);
    if (direct) {
      assertDirectOrigin(request);
      if (mode === "server") serverApiOrigin();
    } else assertSameOrigin(request);
    consumeRateLimit(loginBucket(request), 8, 60_000);
    const body = await readJson(request);
    if (!checkPassword(body.password)) throw new AppError("BAD_PASSWORD", "Mật khẩu chưa đúng. Hãy thử lại.", 401);
    const session = createSession();
    const token = sealToken("session", session);
    if (direct) return privateJson({ authenticated: true, token, expiresAt: session.exp });
    const response = privateJson({ authenticated: true });
    response.headers.set("Set-Cookie", sessionCookie(token));
    return response;
  } catch (error) { return errorResponse(error); }
}

async function deleteAuth(request: Request) {
  try {
    requireBrowserMode();
    const mode = relayMode();
    const direct = isDirectBackendMode(mode);
    if (direct) {
      assertDirectOrigin(request);
      if (mode === "server") serverApiOrigin();
    } else assertSameOrigin(request);
    const response = privateJson({ authenticated: false });
    if (!direct) response.headers.set("Set-Cookie", sessionCookie("", 0));
    return response;
  } catch (error) { return errorResponse(error); }
}

export const GET = (request: Request) => withServerCors(request, () => getAuth(request));
export const POST = (request: Request) => withServerCors(request, () => postAuth(request));
export const DELETE = (request: Request) => withServerCors(request, () => deleteAuth(request));
export const OPTIONS = (request: Request) => serverPreflight(request, ["GET", "POST", "DELETE"]);
