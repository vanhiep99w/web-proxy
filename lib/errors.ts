export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof AppError;
  if (!known) {
    // Never log upstream URLs, tokens, credentials, or the full SDK error object.
    console.error("[relay] Request failed:", error instanceof Error ? error.name : "UnknownError");
  }
  return Response.json({
    error: {
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "Không thể xử lý yêu cầu. Vui lòng thử lại.",
    },
  }, {
    status: known ? error.status : 500,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Relay-Error": known ? error.code : "INTERNAL_ERROR",
    },
  });
}

export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
