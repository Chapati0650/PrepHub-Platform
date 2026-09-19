// Turns whatever the Owner pastes — a watch URL, a share link, a Shorts link,
// an embed URL, or a bare id — into the 11-character video id, or null.
//
// Only the id is stored. Storing the pasted URL would mean parsing it again
// at render time on every student's page load, and would let one stray
// "&t=42s" or a playlist parameter change what plays.
const ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return ID.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && ID.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]) && ID.test(parts[1])) return parts[1];
  }
  return null;
}

// Privacy-enhanced host: no viewing-history cookies are set until the
// student actually presses play. `rel=0` keeps "related videos" to this
// channel rather than whatever YouTube would otherwise surface to a teenager
// on a study site.
export function youTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
}

export function youTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
