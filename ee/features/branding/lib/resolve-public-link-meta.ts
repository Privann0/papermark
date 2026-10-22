export const DEFAULT_LINK_FAVICON = "/favicon.ico";

export type ResolvedPublicLinkMeta = {
  enableCustomMetatag: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  metaImage: string | null;
  metaFavicon: string;
};

type LinkMetaFields = {
  enableCustomMetatag: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaImage?: string | null;
  metaFavicon?: string | null;
};

type BrandLinkPreviewFields = {
  customLinkPreviewEnabled?: boolean | null;
  linkPreviewTitle?: string | null;
  linkPreviewDescription?: string | null;
  linkPreviewImage?: string | null;
  linkPreviewFavicon?: string | null;
};

const firstSet = (...values: (string | null | undefined)[]): string | null =>
  values.find((v) => typeof v === "string" && v.trim() !== "") ?? null;

/**
 * Resolve the social-preview metadata for a public link page.
 *
 * Precedence per field: the link's own custom meta tags (when enabled), then
 * the brand's link preview (when `customLinkPreviewEnabled`), where the
 * dataroom brand wins over the team brand. Callers pass only the brand that
 * applies to the link (the other one as `null`). The result is serialised into
 * `getStaticProps`, so every field is either a value or `null`, never
 * `undefined`.
 */
export function resolvePublicLinkMeta({
  link,
  teamBrand,
  dataroomBrand,
  defaultTitle,
}: {
  link: LinkMetaFields;
  teamBrand: BrandLinkPreviewFields | null | undefined;
  dataroomBrand: BrandLinkPreviewFields | null | undefined;
  defaultTitle: string;
}): ResolvedPublicLinkMeta {
  const brand = [dataroomBrand, teamBrand].find(
    (b) => b?.customLinkPreviewEnabled,
  );
  const linkEnabled = !!link.enableCustomMetatag;

  if (!linkEnabled && !brand) {
    return {
      enableCustomMetatag: false,
      metaTitle: null,
      metaDescription: null,
      metaImage: null,
      metaFavicon: DEFAULT_LINK_FAVICON,
    };
  }

  const fromLink = linkEnabled ? link : null;

  return {
    enableCustomMetatag: true,
    metaTitle:
      firstSet(fromLink?.metaTitle, brand?.linkPreviewTitle) ?? defaultTitle,
    metaDescription: firstSet(
      fromLink?.metaDescription,
      brand?.linkPreviewDescription,
    ),
    metaImage: firstSet(fromLink?.metaImage, brand?.linkPreviewImage),
    metaFavicon:
      firstSet(fromLink?.metaFavicon, brand?.linkPreviewFavicon) ??
      DEFAULT_LINK_FAVICON,
  };
}
