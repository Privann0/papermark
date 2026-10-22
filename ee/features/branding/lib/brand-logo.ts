export type BrandLogoFields = {
  logo?: string | null;
  hideLogo?: boolean | null;
};

/**
 * What goes in a logo slot:
 * - `custom`: the brand's uploaded logo
 * - `papermark`: no logo uploaded, fall back to the Papermark wordmark
 * - `none`: the admin chose "Show no logo", which wins over an uploaded logo
 */
export type ResolvedBrandLogo =
  | { kind: "custom"; src: string }
  | { kind: "papermark" }
  | { kind: "none" };

export function resolveBrandLogo(
  brand: BrandLogoFields | null | undefined,
): ResolvedBrandLogo {
  if (brand?.hideLogo) return { kind: "none" };
  if (brand?.logo) return { kind: "custom", src: brand.logo };
  return { kind: "papermark" };
}

/**
 * Merge dataroom-level logo fields over the team brand. A dataroom logo
 * replaces the team logo when set; `hideLogo` is nullable on DataroomBrand,
 * where `null` means "inherit the team setting".
 */
export function mergeBrandLogoFields({
  dataroom,
  team,
}: {
  dataroom: BrandLogoFields | null | undefined;
  team: BrandLogoFields | null | undefined;
}): { logo: string | null; hideLogo: boolean } {
  return {
    logo: dataroom?.logo || team?.logo || null,
    hideLogo: dataroom?.hideLogo ?? team?.hideLogo ?? false,
  };
}
