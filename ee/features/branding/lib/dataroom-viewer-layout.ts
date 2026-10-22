import { z } from "zod";

// Allowed values for the TEXT layout columns on Brand and DataroomBrand.
// The database stores plain strings; these schemas are the source of truth.

export const DataroomCardLayoutSchema = z.enum(["LIST", "GRID", "COMPACT"]);
export type DataroomCardLayout = z.infer<typeof DataroomCardLayoutSchema>;

export const DataroomViewerHeaderStyleSchema = z.enum([
  "DEFAULT",
  "SPLIT",
  "NOTION",
]);
export type DataroomViewerHeaderStyle = z.infer<
  typeof DataroomViewerHeaderStyleSchema
>;

// The four selectable preset cards in the branding UI.
export type DataroomLayoutCardId = "STANDARD" | "STRICT" | "MODERN" | "NOTION";

// "CUSTOM" is persisted when the individual layout fields don't match any
// preset card (the UI posts the derived preset on save).
export const DataroomViewerLayoutPresetSchema = z.enum([
  "STANDARD",
  "STRICT",
  "MODERN",
  "NOTION",
  "CUSTOM",
]);
export type DataroomViewerLayoutPreset = z.infer<
  typeof DataroomViewerLayoutPresetSchema
>;

export const DEFAULT_DATAROOM_CARD_LAYOUT: DataroomCardLayout = "LIST";
export const DEFAULT_DATAROOM_VIEWER_HEADER_STYLE: DataroomViewerHeaderStyle =
  "DEFAULT";

export const CARD_LAYOUT_OPTIONS: {
  value: DataroomCardLayout;
  label: string;
}[] = [
  { value: "LIST", label: "List" },
  { value: "GRID", label: "Grid" },
  { value: "COMPACT", label: "Compact" },
];

export function asDataroomCardLayout(value: unknown): DataroomCardLayout {
  const parsed = DataroomCardLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DATAROOM_CARD_LAYOUT;
}

export function asDataroomViewerHeaderStyle(
  value: unknown,
): DataroomViewerHeaderStyle {
  const parsed = DataroomViewerHeaderStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DATAROOM_VIEWER_HEADER_STYLE;
}

type DataroomViewerLayoutFields = {
  cardLayout: DataroomCardLayout;
  showFolderTree: boolean;
  hideFolderIconsInMain: boolean;
  viewerHeaderStyle: DataroomViewerHeaderStyle;
};

// Field values for each preset card. Must stay in sync with
// `applyLayoutPreset` in pages/branding.tsx and the dataroom branding page.
export const DATAROOM_LAYOUT_PRESETS: Record<
  DataroomLayoutCardId,
  DataroomViewerLayoutFields
> = {
  STANDARD: {
    cardLayout: "LIST",
    showFolderTree: true,
    viewerHeaderStyle: "DEFAULT",
    hideFolderIconsInMain: false,
  },
  STRICT: {
    cardLayout: "COMPACT",
    showFolderTree: false,
    viewerHeaderStyle: "DEFAULT",
    hideFolderIconsInMain: true,
  },
  MODERN: {
    cardLayout: "COMPACT",
    showFolderTree: false,
    viewerHeaderStyle: "SPLIT",
    hideFolderIconsInMain: true,
  },
  NOTION: {
    cardLayout: "GRID",
    showFolderTree: false,
    viewerHeaderStyle: "NOTION",
    hideFolderIconsInMain: false,
  },
};

export function inferDataroomViewerLayoutPreset(
  fields: DataroomViewerLayoutFields,
): DataroomLayoutCardId | "CUSTOM" {
  const ids = Object.keys(DATAROOM_LAYOUT_PRESETS) as DataroomLayoutCardId[];
  const match = ids.find((id) => {
    const preset = DATAROOM_LAYOUT_PRESETS[id];
    return (
      preset.cardLayout === fields.cardLayout &&
      preset.showFolderTree === fields.showFolderTree &&
      preset.hideFolderIconsInMain === fields.hideFolderIconsInMain &&
      preset.viewerHeaderStyle === fields.viewerHeaderStyle
    );
  });
  return match ?? "CUSTOM";
}
