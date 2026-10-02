// Shared by the frontend's CSP and API client. Never interpolate an unchecked URL.
export function normalizeApiOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || /[*;,\s]/.test(url.hostname) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("API origin must be an HTTPS origin (HTTP loopback is allowed locally)");
  }
  return url.origin;
}
