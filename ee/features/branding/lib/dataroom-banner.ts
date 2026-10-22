export type DataroomBannerKind = "none" | "image" | "video" | "youtube";

export type ClassifiedDataroomBanner = {
  kind: DataroomBannerKind;
  src?: string;
  youtubeId?: string;
};

// Sentinel stored in `banner` when the admin hides the banner entirely.
export const NO_BANNER = "no-banner";

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i;
// YouTube IDs are 11 chars of [A-Za-z0-9_-]. The ID is interpolated into an
// embed URL, so anything outside that alphabet is rejected.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function getYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  let id: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") {
      id = url.searchParams.get("v");
    } else if (
      first === "embed" ||
      first === "shorts" ||
      first === "live" ||
      first === "v"
    ) {
      id = second ?? null;
    }
  }

  return id && YOUTUBE_ID.test(id) ? id : null;
}

export function classifyDataroomBanner(
  src: string | null | undefined,
): ClassifiedDataroomBanner {
  const value = src?.trim();
  if (!value || value === NO_BANNER) return { kind: "none" };

  if (value.startsWith("data:video/")) return { kind: "video", src: value };
  if (value.startsWith("data:") || value.startsWith("blob:")) {
    return { kind: "image", src: value };
  }

  let url: URL;
  try {
    // Relative paths (e.g. the bundled default banner) resolve against a
    // placeholder origin; only the pathname is inspected for them.
    url = new URL(value, "https://placeholder.invalid");
  } catch {
    return { kind: "image", src: value };
  }

  const youtubeId = getYouTubeId(url);
  if (youtubeId) return { kind: "youtube", src: value, youtubeId };

  if (VIDEO_EXTENSIONS.test(url.pathname)) return { kind: "video", src: value };

  return { kind: "image", src: value };
}
