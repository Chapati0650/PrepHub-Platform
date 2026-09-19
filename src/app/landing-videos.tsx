"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { youTubeEmbedUrl } from "@/lib/curriculum/youtube";
import { formatViewCount } from "@/lib/youtube/format-views";

export type LandingVideoCardProps = {
  id: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number | null;
};

// A "lite" embed: the card is a thumbnail until it is clicked, and only then
// becomes the YouTube iframe. Three real players on first paint would each
// pull YouTube's full player bundle onto a page whose job is to load fast;
// three thumbnails cost one small image each. The iframe autoplays because
// the visitor has just clicked play — that click is the intent.
export function LandingVideoCard({ id, title, thumbnailUrl, viewCount }: LandingVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
        {playing ? (
          <iframe
            src={`${youTubeEmbedUrl(id)}&autoplay=1`}
            title={title}
            className="absolute inset-0 size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play: ${title}`}
            className="group absolute inset-0 size-full focus-visible:ring-3 focus-visible:ring-marker focus-visible:outline-none"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-surface-deep-foreground text-surface-deep shadow-lg transition-transform group-hover:scale-105">
                <Play className="ml-0.5 size-6" fill="currentColor" aria-hidden />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 font-medium text-surface-deep-foreground">{title}</p>
        {viewCount !== null && (
          <p className="mt-1 text-sm text-surface-deep-foreground/60 tabular-nums">{formatViewCount(viewCount)} views</p>
        )}
      </div>
    </div>
  );
}
