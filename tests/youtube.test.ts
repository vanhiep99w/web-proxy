import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "@/lib/auth";
import { readMediaTicket } from "@/lib/media";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ basicInfo: vi.fn(), probe: vi.fn() }));
vi.mock("youtubei.js", () => ({
  Innertube: { create: async () => ({ getBasicInfo: mocks.basicInfo, session: { player: undefined } }) },
  Log: { setLevel: () => {}, Level: { NONE: 0 } },
  Platform: { shim: {} },
}));
vi.mock("@/lib/media", async (original) => ({ ...await original<typeof import("@/lib/media")>(), fetchMediaRange: mocks.probe }));
import { resolveVideo } from "@/lib/youtube";

type FixtureFormat = ReturnType<typeof makeFormat>;
function makeFormat(itag: number, audio: boolean, height?: number, drc = false) {
  const url = `https://rr1.googlevideo.com/videoplayback?itag=${itag}&expire=${Math.floor(Date.now() / 1000) + 3600}`;
  return {
    itag, url, height, has_audio: audio, has_video: !audio,
    mime_type: audio ? 'audio/mp4; codecs="mp4a.40.2"' : 'video/mp4; codecs="avc1.4D400C"',
    content_length: 10000, init_range: { start: 0, end: 100 }, index_range: { start: 101, end: 200 },
    bitrate: 128000, is_drc: drc, is_type_otf: false,
    decipher: async () => url,
  };
}
function fixture(formats: FixtureFormat[]) {
  return {
    basic_info: { title: "Public video", author: "Author", duration: 45 },
    playability_status: { status: "OK" },
    streaming_data: { adaptive_formats: formats }, cpn: "nonce",
    // Match YouTube.js's exclusion-predicate semantics, not Array.filter semantics.
    toDash: async (options: { format_filter: (format: FixtureFormat) => boolean; url_transformer: (url: URL) => URL }) => {
      const chosen = formats.filter((format) => !options.format_filter(format));
      return `<MPD>${chosen.map((format) => `<BaseURL>${options.url_transformer(new URL(format.url))}</BaseURL>`).join("")}</MPD>`;
    },
  };
}
beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", "random-password-at-least-16");
  vi.stubEnv("AUTH_SECRET", "random-secret-at-least-32-characters-for-testing");
  mocks.probe.mockImplementation(async () => new Response(new Uint8Array(1)));
  mocks.basicInfo.mockResolvedValue(fixture([makeFormat(140, true), makeFormat(141, true, undefined, true), makeFormat(133, false, 240), makeFormat(134, false, 360), makeFormat(136, false, 720)]));
});

describe("YouTube resolve and manifest capabilities", () => {
  it("selects only compatible formats below the quality ceiling and uses same-origin capabilities", async () => {
    const session = createSession();
    const result = await resolveVideo("jNQXAC9IVRw", "video", 360, session, "https://relay.test");
    expect(result.quality).toBe("Tối đa 360p");
    expect(mocks.basicInfo).toHaveBeenCalledWith("jNQXAC9IVRw", { client: "IOS" });
    const urls = [...result.manifest.matchAll(/<BaseURL>(.*?)<\/BaseURL>/g)].map((match) => new URL(match[1]));
    expect(urls).toHaveLength(3);
    const itags = urls.map((url) => {
      expect(url.origin).toBe("https://relay.test");
      expect(url.pathname).toBe("/api/stream");
      const media = readMediaTicket(url.searchParams.get("ticket")!, session);
      return Number(new URL(media.url).searchParams.get("itag"));
    });
    expect(itags).toEqual([140, 133, 134]);
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    expect(result.manifest).not.toContain("googlevideo.com");
  });
  it("audio-only mode never includes a video representation", async () => {
    const result = await resolveVideo("jNQXAC9IVRw", "audio", 720, createSession(), "https://relay.test");
    expect(result.quality).toBe("Chỉ âm thanh");
    expect([...result.manifest.matchAll(/<BaseURL>/g)]).toHaveLength(1);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
  });
  it("does not call playback successful when the probe is blocked", async () => {
    mocks.probe.mockRejectedValueOnce(new AppError("UPSTREAM_BLOCKED", "Blocked", 502));
    await expect(resolveVideo("jNQXAC9IVRw", "video", 360, createSession(), "https://relay.test")).rejects.toMatchObject({ code: "UPSTREAM_BLOCKED" });
  });
  it("refuses login-gated content without accepting account cookies", async () => {
    const info = fixture([]); info.playability_status.status = "LOGIN_REQUIRED";
    mocks.basicInfo.mockResolvedValueOnce(info);
    await expect(resolveVideo("jNQXAC9IVRw", "video", 360, createSession(), "https://relay.test")).rejects.toMatchObject({ code: "UPSTREAM_BLOCKED" });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("clearly rejects descriptors with no directly readable URL", async () => {
    mocks.basicInfo.mockResolvedValueOnce(fixture([]));
    await expect(resolveVideo("jNQXAC9IVRw", "video", 360, createSession(), "https://relay.test")).rejects.toMatchObject({ code: "NO_COMPATIBLE_STREAM" });
  });
});
