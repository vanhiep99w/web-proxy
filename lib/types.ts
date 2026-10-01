export type PlaybackMode = "video" | "audio";
export type VideoQuality = 360 | 720;

export type VideoMetadata = {
  id: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
};

export type PlaybackSource = VideoMetadata & {
  manifest: string;
  mode: PlaybackMode;
  quality: string;
  expiresAt: number;
};

export type HistoryItem = VideoMetadata & { playedAt: number };
export type ApiErrorBody = { error: { code: string; message: string } };
