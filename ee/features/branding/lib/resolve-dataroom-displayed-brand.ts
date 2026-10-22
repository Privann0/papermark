import { mergeBrandLogoFields } from "./brand-logo";

// Select value meaning "this dataroom uses its own DataroomBrand" (stored as
// `brandId = null`). Radix Select can't use "" and it must never look like a
// cuid, so it can't collide with a real Brand id.
export const CUSTOM_DATAROOM_BRAND = "__custom_dataroom_brand__";
export const CUSTOM_DATAROOM_BRAND_LABEL = "Custom brand";

/**
 * Whether a dataroom view shows a team Brand as-is instead of the dataroom's
 * own DataroomBrand: a link-level brand or a dataroom base brand selects a team
 * brand, and a dataroom without a DataroomBrand row has nothing of its own.
 */
export function inheritsTeamBrand({
  linkBrandId,
  dataroomBrandId,
  hasDataroomBrand,
}: {
  linkBrandId?: string | null;
  dataroomBrandId?: string | null;
  hasDataroomBrand: boolean;
}): boolean {
  return Boolean(linkBrandId) || Boolean(dataroomBrandId) || !hasDataroomBrand;
}

type DisplayedBrandFields = {
  logo?: string | null;
  hideLogo?: boolean | null;
  banner?: string | null;
  brandColor?: string | null;
  accentColor?: string | null;
  accentButtonColor?: string | null;
  applyAccentColorToDataroomView?: boolean | null;
  welcomeMessage?: string | null;
  cardLayout?: string | null;
  showFolderTree?: boolean | null;
  viewerLayoutPreset?: string | null;
  viewerHeaderStyle?: string | null;
  hideFolderIconsInMain?: boolean | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  defaultLanguage?: string | null;
};

type TeamDisplayedBrandFields = DisplayedBrandFields & {
  privacyPolicyUrl?: string | null;
};

export type DisplayedDataroomBrand = {
  logo: string | null;
  hideLogo: boolean;
  banner: string | null;
  brandColor: string | null;
  accentColor: string | null;
  accentButtonColor: string | null;
  applyAccentColorToDataroomView: boolean;
  welcomeMessage: string | null;
  cardLayout: string;
  showFolderTree: boolean;
  viewerLayoutPreset: string;
  viewerHeaderStyle: string;
  hideFolderIconsInMain: boolean;
  ctaLabel: string | null;
  ctaUrl: string | null;
  defaultLanguage: string;
  privacyPolicyUrl: string | null;
};

/**
 * The brand a dataroom viewer renders. When inheriting, the team brand is
 * shown on its own; otherwise the DataroomBrand is layered over it. Text and
 * colour fields fall back on empty values (`||`), toggles and layout fields
 * only when unset (`??`), then the column defaults apply. `privacyPolicyUrl`
 * is team-level only.
 */
export function resolveDisplayedDataroomBrand({
  dataroomBrand,
  teamBrand,
  inheritTeamBrand,
}: {
  dataroomBrand: DisplayedBrandFields | null | undefined;
  teamBrand: TeamDisplayedBrandFields | null | undefined;
  inheritTeamBrand: boolean;
}): DisplayedDataroomBrand {
  const room = inheritTeamBrand ? null : dataroomBrand;

  return {
    ...mergeBrandLogoFields({ dataroom: room, team: teamBrand }),
    banner: room?.banner || teamBrand?.banner || null,
    brandColor: room?.brandColor || teamBrand?.brandColor || null,
    accentColor: room?.accentColor || teamBrand?.accentColor || null,
    accentButtonColor:
      room?.accentButtonColor || teamBrand?.accentButtonColor || null,
    applyAccentColorToDataroomView:
      room?.applyAccentColorToDataroomView ??
      teamBrand?.applyAccentColorToDataroomView ??
      false,
    welcomeMessage: room?.welcomeMessage || teamBrand?.welcomeMessage || null,
    cardLayout: room?.cardLayout ?? teamBrand?.cardLayout ?? "LIST",
    showFolderTree: room?.showFolderTree ?? teamBrand?.showFolderTree ?? true,
    viewerLayoutPreset:
      room?.viewerLayoutPreset ?? teamBrand?.viewerLayoutPreset ?? "STANDARD",
    viewerHeaderStyle:
      room?.viewerHeaderStyle ?? teamBrand?.viewerHeaderStyle ?? "DEFAULT",
    hideFolderIconsInMain:
      room?.hideFolderIconsInMain ?? teamBrand?.hideFolderIconsInMain ?? false,
    ctaLabel: room?.ctaLabel ?? teamBrand?.ctaLabel ?? null,
    ctaUrl: room?.ctaUrl ?? teamBrand?.ctaUrl ?? null,
    defaultLanguage:
      room?.defaultLanguage ?? teamBrand?.defaultLanguage ?? "en",
    privacyPolicyUrl: teamBrand?.privacyPolicyUrl ?? null,
  };
}
