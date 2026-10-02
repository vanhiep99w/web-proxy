"use client";

/* eslint-disable @next/next/no-img-element -- Private images use a session cookie or an authenticated blob. */
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import type { ApiClient } from "@/lib/api-client";
import { VIDEO_ID } from "@/lib/video-id";

export function usePrivateThumbnail(api: ApiClient, id: string): string | undefined {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!api.direct || !VIDEO_ID.test(id)) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await api.request(`/api/thumbnail?id=${id}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok || response.headers.get("content-type") !== "image/jpeg") return;
        const blob = await response.blob();
        if (controller.signal.aborted || blob.size > 1024 * 1024) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ id, url: objectUrl });
      } catch { /* A failed thumbnail must not prevent playback. */ }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, id]);
  if (!VIDEO_ID.test(id)) return undefined;
  return api.direct ? image?.id === id ? image.url : undefined : `/api/thumbnail?id=${id}`;
}

export default function PrivateThumbnail({ api, id, ...props }: {
  api: ApiClient; id: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "id">) {
  const src = usePrivateThumbnail(api, id);
  return src ? <img {...props} src={src} alt={props.alt || ""} /> : null;
}
