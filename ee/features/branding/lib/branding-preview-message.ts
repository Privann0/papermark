/**
 * Shared contract for the postMessage channel between branding editors and
 * their preview iframe pages.
 */
export const BRANDING_PREVIEW_MESSAGE = "papermark:branding-preview" as const;

export const BRANDING_PREVIEW_READY =
  "papermark:branding-preview-ready" as const;

export type BrandingPreviewParams = Record<string, string>;
