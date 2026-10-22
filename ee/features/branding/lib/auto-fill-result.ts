export const AUTO_FILL_NOT_FOUND_MESSAGE =
  "No brand data found for that website";

type AutoFillResult = {
  logo?: unknown;
  banner?: unknown;
  brandColor?: unknown;
  accentColor?: unknown;
  accentButtonColor?: unknown;
};

export function autoFillHasBrandAssets(
  data: AutoFillResult,
  { allowBanner }: { allowBanner: boolean },
): boolean {
  return Boolean(
    data.logo ||
    data.brandColor ||
    data.accentColor ||
    data.accentButtonColor ||
    (allowBanner && data.banner),
  );
}
