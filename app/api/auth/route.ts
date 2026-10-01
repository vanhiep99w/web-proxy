import { checkPassword, createSession, requireConfiguration, sealToken, sessionCookie, sessionFromRequest } from "@/lib/auth";
import { AppError, errorResponse, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/http";
import { consumeRateLimit, loginBucket } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireConfiguration();
    return privateJson({ authenticated: !!sessionFromRequest(request) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    consumeRateLimit(loginBucket(request), 8, 60_000);
    const body = await readJson(request);
    if (!checkPassword(body.password)) throw new AppError("BAD_PASSWORD", "Mật khẩu chưa đúng. Hãy thử lại.", 401);
    const session = createSession();
    const response = privateJson({ authenticated: true });
    response.headers.set("Set-Cookie", sessionCookie(sealToken("session", session)));
    return response;
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = privateJson({ authenticated: false });
    response.headers.set("Set-Cookie", sessionCookie("", 0));
    return response;
  } catch (error) { return errorResponse(error); }
}
