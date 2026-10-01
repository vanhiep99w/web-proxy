"use client";

/* eslint-disable @next/next/no-img-element -- Private thumbnail endpoints require the browser's session cookie. */
import { useEffect, useRef } from "react";
import type { MediaPlayerClass } from "dashjs";
import type { PlaybackSource } from "@/lib/types";

export default function DashPlayer({ source, resumeTime, onReady, onPlaying, onWaiting, onPause, onEnded, onFailure, mediaRef }: {
  source: PlaybackSource;
  resumeTime: number;
  onReady: () => void;
  onPlaying: () => void;
  onWaiting: () => void;
  onPause: () => void;
  onEnded: () => void;
  onFailure: (message: string) => void;
  mediaRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const root = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    let stopped = false;
    let failed = false;
    let player: MediaPlayerClass | undefined;
    let manifestUrl: string | undefined;
    const fail = (message: string) => { if (!stopped && !failed) { failed = true; onFailure(message); } };
    const initialize = async () => {
      if (!("MediaSource" in window)) {
        fail("Trình duyệt chưa hỗ trợ DASH / MediaSource. Hãy thử Chrome, Edge hoặc Firefox bản mới.");
        return;
      }
      try {
        const dash = await import("dashjs");
        if (stopped || !root.current) return;
        player = dash.MediaPlayer().create();
        player.updateSettings({
          debug: { logLevel: dash.Debug.LOG_LEVEL_NONE },
          streaming: {
            utcSynchronization: { enabled: false },
            cmcd: { enabled: false },
            buffer: { bufferTimeDefault: 8, bufferTimeAtTopQuality: 12, bufferTimeAtTopQualityLongForm: 12 },
          },
        });
        player.on(dash.MediaPlayer.events.ERROR, () => {
          fail("Không phát được đoạn media. Luồng có thể đã hết hạn hoặc YouTube từ chối IP Vercel. Thử lấy lại luồng, chọn 360p hoặc chỉ nghe.");
        });
        player.on(dash.MediaPlayer.events.STREAM_INITIALIZED, () => { if (!stopped) onReady(); });
        manifestUrl = URL.createObjectURL(new Blob([source.manifest], { type: "application/dash+xml" }));
        player.initialize(root.current, manifestUrl, true, resumeTime > 0 ? resumeTime : undefined);
      } catch {
        fail("Không khởi tạo được trình phát. Hãy tải lại trang hoặc thử trình duyệt khác.");
      }
    };
    void initialize();
    return () => {
      stopped = true;
      player?.reset();
      if (manifestUrl) URL.revokeObjectURL(manifestUrl);
    };
  }, [source.manifest, resumeTime, onReady, onFailure]);

  return <div className={`media-container ${source.mode === "audio" ? "audio-container" : ""}`}>
    {source.mode === "audio" && <div className="audio-art" aria-hidden="true">
      <img src={source.thumbnail} alt="" className="audio-cover" />
      <span className="audio-art-label">AUDIO ONLY</span>
    </div>}
    <video
      ref={(element) => { root.current = element; mediaRef.current = element; }}
      className="native-media" controls playsInline preload="metadata"
      poster={source.mode === "video" ? source.thumbnail : undefined}
      aria-label={`Trình phát: ${source.title}`}
      onPlaying={onPlaying} onWaiting={onWaiting} onPause={onPause} onEnded={onEnded}
    />
  </div>;
}
