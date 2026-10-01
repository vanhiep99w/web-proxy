import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, createSession, isConfigured, openToken, parseSession, sealToken, sessionCookie } from "@/lib/auth";
import { mintMediaTicket, readMediaTicket } from "@/lib/media";

beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", "random-password-at-least-16");
  vi.stubEnv("AUTH_SECRET", "random-secret-at-least-32-characters-for-testing");
});

describe("private authentication", () => {
  it("fails closed without strong server configuration", () => {
    vi.stubEnv("AUTH_SECRET", "short");
    expect(isConfigured()).toBe(false);
    expect(() => checkPassword("anything")).toThrow();
    expect(parseSession("invalid")).toBeNull();
  });
  it.each(["a", "abc", "short-password"])("accepts a non-empty password below 16 characters: %s", (password) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_PASSWORD", password);
    expect(isConfigured()).toBe(true);
    expect(checkPassword(password)).toBe(true);
    expect(checkPassword("")).toBe(false);
  });
  it.each([undefined, ""])("fails closed for a missing or empty password", (password) => {
    vi.stubEnv("ACCESS_PASSWORD", password);
    expect(isConfigured()).toBe(false);
    expect(() => checkPassword("")).toThrow();
  });
  it("checks passwords without accepting missing or malformed input", () => {
    expect(checkPassword("random-password-at-least-16")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword(undefined)).toBe(false);
    expect(checkPassword({})).toBe(false);
  });
  it("creates, validates, and expires a session", () => {
    const session = createSession();
    const token = sealToken("session", session);
    expect(parseSession(token)).toEqual(session);
    expect(parseSession(token, session.exp * 1000)).toBeNull();
    expect(token).not.toContain(session.sid);
  });
  it("rejects tampering and cross-scope use", () => {
    const token = sealToken("session", createSession());
    expect(() => openToken("media", token)).toThrow();
    const bytes = Buffer.from(token, "base64url"); bytes[30] ^= 1;
    expect(parseSession(bytes.toString("base64url"))).toBeNull();
    expect(parseSession("!!!!")).toBeNull();
    expect(parseSession("x".repeat(17000))).toBeNull();
  });
  it("changing password invalidates existing sessions", () => {
    const token = sealToken("session", createSession());
    vi.stubEnv("ACCESS_PASSWORD", "another-strong-password");
    expect(parseSession(token)).toBeNull();
  });
  it("uses secure, private cookies in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("token")).toContain("HttpOnly; SameSite=Strict");
    expect(sessionCookie("token")).toContain("; Secure");
    expect(sessionCookie("", 0)).toContain("Max-Age=0");
  });
});

describe("encrypted media capabilities", () => {
  it("requires the issuing session and expires", () => {
    const session = createSession();
    const data = { url: "https://rr1---sn-example.googlevideo.com/videoplayback?itag=140", total: 1000, mime: 'audio/mp4; codecs="mp4a.40.2"', sid: session.sid, exp: Math.floor(Date.now() / 1000) + 60 };
    const token = mintMediaTicket(data);
    expect(readMediaTicket(token, session)).toEqual(data);
    expect(token).not.toContain("googlevideo");
    expect(() => readMediaTicket(token, createSession())).toThrow();
    expect(() => readMediaTicket(token, session, data.exp * 1000)).toThrow();
  });
  it("rejects malformed capability fields even when authenticated", () => {
    const session = createSession();
    const token = sealToken("media", { url: "https://evil.test/", total: -1, mime: "text/html", sid: session.sid, exp: session.exp });
    expect(() => readMediaTicket(token, session)).toThrow();
  });
});
