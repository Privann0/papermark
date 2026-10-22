import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

export type LogoTone = "light" | "dark" | "unknown";

// Downscale before reading pixels; tone only needs a coarse average.
const SAMPLE_SIZE = 32;
// Pixels below this alpha are background, not logo.
const MIN_ALPHA = 32;
const LIGHT_LUMINANCE_THRESHOLD = 0.7;

function measureLogoTone(img: HTMLImageElement): LogoTone {
  const width = Math.min(SAMPLE_SIZE, img.naturalWidth);
  const height = Math.min(SAMPLE_SIZE, img.naturalHeight);
  if (!width || !height) return "unknown";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "unknown";

  ctx.drawImage(img, 0, 0, width, height);
  // Throws a SecurityError when the host doesn't send CORS headers.
  const { data } = ctx.getImageData(0, 0, width, height);

  let weighted = 0;
  let totalAlpha = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < MIN_ALPHA) continue;
    const luminance =
      (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    weighted += luminance * alpha;
    totalAlpha += alpha;
  }
  if (!totalAlpha) return "unknown";

  return weighted / totalAlpha >= LIGHT_LUMINANCE_THRESHOLD ? "light" : "dark";
}

/**
 * Classify a logo as light or dark from its averaged opaque-pixel luminance,
 * so callers can pick a contrasting backdrop. Spread `imgProps` onto the
 * displayed `<img>` (with `crossOrigin="anonymous"`) to analyse that decode
 * instead of fetching the image twice. Stays "unknown" while loading or when
 * pixels can't be read.
 */
export function useLogoTone(src: string | null | undefined): {
  tone: LogoTone;
  imgProps: { onLoad: (event: SyntheticEvent<HTMLImageElement>) => void };
} {
  const [tone, setTone] = useState<LogoTone>("unknown");

  useEffect(() => {
    setTone("unknown");
  }, [src]);

  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    try {
      setTone(measureLogoTone(event.currentTarget));
    } catch {
      setTone("unknown");
    }
  }, []);

  return { tone, imgProps: { onLoad } };
}
