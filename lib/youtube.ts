import { Innertube, Log, Platform, type YT } from "youtubei.js";
import { evaluatePlayer } from "@/lib/evaluator";
import { AppError } from "@/lib/errors";
import { fetchMediaRange, mintMediaTicket, validateMediaUrl } from "@/lib/media";
import type { Session } from "@/lib/auth";
import type { PlaybackMode, PlaybackSource, VideoQuality } from "@/lib/types";

Log.setLevel(Log.Level.NONE);
Platform.shim.eval = (data) => evaluatePlayer(data.output);

let cached: { promise: Promise<Innertube>; expires: number } | undefined;
const playerCache = new Map<string, ArrayBuffer>();

async function getClient(): Promise<Innertube> {
  if (!cached || cached.expires <= Date.now()) {
    const promise = Innertube.create({
      lang: "vi", location: "VN", retrieve_player: true,
      cache: {
        cache_dir: "memory://relay",
        async get(id) { return playerCache.get(id); },
        async set(id, value) {
          if (playerCache.size > 16) playerCache.clear();
          playerCache.set(id, value);
        },
        async remove(id) { playerCache.delete(id); },
      },
      fetch: (input, init) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return fetch(input, {
          ...init, cache: "no-store",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        });
      },
    });
    cached = { promise, expires: Date.now() + 15 * 60 * 1000 };
    void promise.catch(() => { if (cached?.promise === promise) cached = undefined; });
  }
  return cached.promise;
}

export async function resolveVideo(id: string, mode: PlaybackMode, quality: VideoQuality, session: Session, origin: string, signal?: AbortSignal): Promise<PlaybackSource> {
  let info: YT.VideoInfo;
  let client: Innertube;
  try {
    client = await getClient();
    // WEB currently returns SABR-only descriptors without directly usable URLs.
    // This client's public VOD formats can still expose byte-range MP4 URLs.
    info = await client.getBasicInfo(id, { client: "IOS" });
  } catch {
    throw new AppError("YOUTUBE_UNREACHABLE", "Không lấy được thông tin từ YouTube. IP Vercel có thể bị chặn; hãy thử lại sau.", 502);
  }
  const status = info.playability_status?.status;
  if (status !== "OK") {
    if (status === "LOGIN_REQUIRED") {
      throw new AppError("UPSTREAM_BLOCKED", "YouTube yêu cầu đăng nhập hoặc xác minh IP. Bản này không nhận cookie tài khoản và không hỗ trợ video hạn chế.", 422);
    }
    throw new AppError("VIDEO_UNAVAILABLE", "YouTube không cho phép phát video này. Có thể video bị hạn chế, không còn tồn tại hoặc IP server bị từ chối.", 422);
  }
  if (info.basic_info.is_live || info.basic_info.is_upcoming || info.basic_info.is_post_live_dvr) {
    throw new AppError("LIVE_UNSUPPORTED", "Bản đầu tiên chỉ hỗ trợ video thông thường, chưa hỗ trợ livestream.", 422);
  }
  const formats = (info.streaming_data?.adaptive_formats ?? []).filter((format) =>
    !!(format.url || format.signature_cipher || format.cipher) &&
    !!format.init_range && !!format.index_range && !!format.content_length && !format.is_type_otf &&
    !format.drm_families?.length && !format.drm_track_type && !format.fair_play_key_uri,
  );
  const audioCandidates = formats.filter((format) => format.has_audio && !format.has_video &&
    format.mime_type.startsWith("audio/mp4") && format.mime_type.includes("mp4a") &&
    !format.is_drc && !format.is_dubbed && !format.is_descriptive && !format.is_secondary);
  const audio = audioCandidates.sort((a, b) => b.bitrate - a.bitrate)[0];
  const videoCandidates = mode === "video" ? formats.filter((format) => format.has_video &&
    !format.has_audio && format.mime_type.startsWith("video/mp4") && format.mime_type.includes("avc1") &&
    !!format.height && format.height <= quality) : [];
  // Keep one H.264 stream per resolution; ABR can switch without crossing the selected ceiling.
  const videoByHeight = new Map<number, typeof videoCandidates[number]>();
  for (const format of videoCandidates.sort((a, b) => a.bitrate - b.bitrate)) {
    if (!videoByHeight.has(format.height!)) videoByHeight.set(format.height!, format);
  }
  if (!audio || (mode === "video" && !videoByHeight.size)) {
    throw new AppError("NO_COMPATIBLE_STREAM", "YouTube không cung cấp luồng MP4 phù hợp. Thử chế độ chỉ nghe; nếu vẫn lỗi thì Vercel-only chưa hỗ trợ video này.", 422);
  }
  const selected = [audio, ...videoByHeight.values()];
  const urls = new Map<number, string>();
  let expiresAt = Math.min(session.exp, Math.floor(Date.now() / 1000) + 2 * 60 * 60);
  try {
    for (const format of selected) {
      const url = validateMediaUrl(await format.decipher(client.session.player));
      url.searchParams.set("cpn", info.cpn);
      const expiry = Number(url.searchParams.get("expire"));
      if (Number.isSafeInteger(expiry) && expiry > 0) expiresAt = Math.min(expiresAt, expiry - 30);
      urls.set(format.itag, url.toString());
    }
  } catch {
    throw new AppError("PLAYER_CHANGED", "YouTube đã thay đổi mã player hoặc URL luồng. Cần cập nhật youtubei.js, không phải lỗi link của bạn.", 502);
  }
  if (expiresAt <= Math.floor(Date.now() / 1000) + 30) {
    throw new AppError("STREAM_EXPIRED", "Luồng đã hết hạn. Vui lòng lấy lại luồng.", 410);
  }
  // Verify both audio and the lowest video stream BEFORE telling the browser playback is available.
  const lowestVideo = [...videoByHeight.values()].sort((a, b) => a.height! - b.height!)[0];
  for (const format of [audio, ...(lowestVideo ? [lowestVideo] : [])]) {
    const probe = await fetchMediaRange(urls.get(format.itag)!, { start: 0, end: 0, length: 1 }, format.content_length!, signal);
    await probe.body?.cancel();
  }
  let manifest: string;
  try {
    manifest = await info.toDash({
      // YouTube.js defines this as an EXCLUSION predicate, unlike Array.filter.
      format_filter: (format) => !selected.includes(format),
      url_transformer: (upstream) => {
        const itag = Number(upstream.searchParams.get("itag"));
        const format = selected.find((item) => item.itag === itag);
        if (!format || !urls.has(itag)) throw new Error("Unknown representation");
        const ticket = mintMediaTicket({
          url: urls.get(itag)!, total: format.content_length!, mime: format.mime_type,
          sid: session.sid, exp: expiresAt,
        });
        const local = new URL("/api/stream", origin);
        local.searchParams.set("ticket", ticket);
        return local;
      },
      manifest_options: { include_thumbnails: false },
    });
  } catch {
    throw new AppError("MANIFEST_FAILED", "Không thể tạo bản phát DASH cho video này.", 502);
  }
  return {
    id, title: info.basic_info.title?.slice(0, 1000) || "Video YouTube",
    author: info.basic_info.author?.slice(0, 500) || info.basic_info.channel?.name?.slice(0, 500) || "YouTube",
    duration: info.basic_info.duration || 0,
    thumbnail: `/api/thumbnail?id=${id}`,
    manifest, mode,
    quality: mode === "audio" ? "Chỉ âm thanh" : `Tối đa ${Math.max(...videoByHeight.keys())}p`,
    expiresAt,
  };
}
