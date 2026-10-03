import { normalizeApiOrigin } from "@/lib/api-origin";

type LoginResult = { token?: unknown; expiresAt?: unknown };

// One client per workspace. Tokens are never written to storage, cookies or URLs.
export class ApiClient {
  readonly origin: string;
  private token = "";
  private expiry = 0;

  constructor(origin = "") {
    this.origin = origin ? normalizeApiOrigin(origin) : "";
  }

  get direct() { return !!this.origin; }
  get expiresAt() { return this.expiry; }

  url(path: string): string {
    if (!/^\/api\/[a-z]+(?:\?[^#]*)?$/.test(path)) throw new Error("Invalid API path");
    return this.origin ? new URL(path, this.origin).toString() : path;
  }

  acceptSession(value: LoginResult) {
    if (!this.direct) return;
    if (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{40,16384}$/.test(value.token) ||
        !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= Math.floor(Date.now() / 1000) ||
        (value.expiresAt as number) > Math.floor(Date.now() / 1000) + 8 * 60 * 60 + 60) {
      throw new Error("Backend returned an invalid session");
    }
    this.token = value.token;
    this.expiry = value.expiresAt as number;
  }

  clearSession() { this.token = ""; this.expiry = 0; }

  authorizationFor(value: string): string | undefined {
    if (!this.direct || !this.token) return undefined;
    if (this.expiry <= Math.floor(Date.now() / 1000)) { this.clearSession(); return undefined; }
    try {
      const url = new URL(value, this.origin);
      if (url.origin === this.origin && !url.username && !url.password && /^\/api\/[a-z]+$/.test(url.pathname)) {
        return `Bearer ${this.token}`;
      }
    } catch { /* Never send credentials to an unexpected URL. */ }
    return undefined;
  }

  request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(path);
    const headers = new Headers(init.headers);
    if (this.direct) {
      headers.delete("authorization");
      const authorization = this.authorizationFor(url);
      if (authorization) headers.set("Authorization", authorization);
    }
    return fetch(url, {
      ...init, headers,
      credentials: this.direct ? "omit" : "same-origin",
      redirect: "error", cache: "no-store",
    });
  }

  async lock(): Promise<void> {
    if (!this.direct) {
      const response = await this.request("/api/auth", { method: "DELETE", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Logout failed");
    }
    // Direct-backend sessions are stateless; locking locally must work even offline.
    this.clearSession();
  }
}
