import { youTubeThumbnailUrl } from "@/lib/curriculum/youtube";

// Server-side only: this reads process.env.YOUTUBE_API_KEY. It is imported
// from the (server) landing page and nowhere else; the client half of the
// feature is src/app/landing-videos.tsx, which receives plain data.

// The three channel videos featured on the public landing page, as the
// Owner listed them (2026-09-19). Titles below are a fallback only — they
// were real at the time of writing, and the live title from YouTube wins
// whenever it can be fetched, so a renamed video renames itself here.
export const LANDING_VIDEOS = [
  { id: "SAIZErXDrK0", fallbackTitle: "Solving the HARDEST SAT Math Questions ONLY using Desmos (From a 1600 Scorer)" },
  { id: "n1Hva7ZCF_s", fallbackTitle: "We Got The December SAT Early..." },
  { id: "xberKXWXfNU", fallbackTitle: "Every ACT Grammar Rule in 15 minutes" },
] as const;

export type LandingVideo = {
  id: string;
  title: string;
  thumbnailUrl: string;
  /** Null when YOUTUBE_API_KEY isn't set or the request failed — the card then shows no count rather than a stale or invented one. */
  viewCount: number | null;
};

// Both requests are cached by Next's data cache and refreshed in the
// background: titles daily, view counts every six hours. The landing page
// itself is dynamic (it checks the session), so without this every visitor
// would cost two round trips to YouTube on the request path.
const TITLE_REVALIDATE_SECONDS = 24 * 60 * 60;
const STATS_REVALIDATE_SECONDS = 6 * 60 * 60;

async function fetchTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
      { next: { revalidate: TITLE_REVALIDATE_SECONDS } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title ? data.title : null;
  } catch {
    return null;
  }
}

// One request for all three videos. The YouTube Data API v3 key is a plain
// API key (no OAuth), restricted to this API in Google Cloud; absent, view
// counts are simply not shown. A failure here is logged nowhere on purpose —
// it is decorative data on a marketing page, and a YouTube outage must not
// page anyone or fail the request.
async function fetchViewCounts(ids: readonly string[]): Promise<Map<string, number>> {
  const key = process.env.YOUTUBE_API_KEY;
  const counts = new Map<string, number>();
  if (!key) return counts;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("key", key);
    const res = await fetch(url, { next: { revalidate: STATS_REVALIDATE_SECONDS } });
    if (!res.ok) return counts;
    const data = (await res.json()) as { items?: { id?: string; statistics?: { viewCount?: string } }[] };
    for (const item of data.items ?? []) {
      const n = Number(item.statistics?.viewCount);
      if (item.id && Number.isFinite(n)) counts.set(item.id, n);
    }
  } catch {
    // fall through with whatever was collected (usually nothing)
  }
  return counts;
}

export async function getLandingVideos(): Promise<LandingVideo[]> {
  const ids = LANDING_VIDEOS.map((v) => v.id);
  const [titles, counts] = await Promise.all([Promise.all(ids.map(fetchTitle)), fetchViewCounts(ids)]);
  return LANDING_VIDEOS.map((v, i) => ({
    id: v.id,
    title: titles[i] ?? v.fallbackTitle,
    thumbnailUrl: youTubeThumbnailUrl(v.id),
    viewCount: counts.get(v.id) ?? null,
  }));
}
