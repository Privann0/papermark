import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { DataroomLayoutCardId } from "../lib/dataroom-viewer-layout";

type DataroomLayoutPresetCardsProps = {
  selectedPreset: DataroomLayoutCardId | "CUSTOM";
  onSelect: (preset: DataroomLayoutCardId) => void;
};

const PRESETS: {
  id: DataroomLayoutCardId;
  label: string;
  description: string;
}[] = [
  {
    id: "STANDARD",
    label: "Standard",
    description: "List view with folder navigation.",
  },
  {
    id: "STRICT",
    label: "Strict",
    description: "Compact view with minimal navigation.",
  },
  {
    id: "MODERN",
    label: "Modern",
    description: "Compact layout with a split header.",
  },
  {
    id: "NOTION",
    label: "Notion",
    description: "Grid layout with a document-style header.",
  },
];

export function DataroomLayoutPresetCards({
  selectedPreset,
  onSelect,
}: DataroomLayoutPresetCardsProps) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      role="radiogroup"
      aria-label="Data Room layout preset"
    >
      {PRESETS.map((preset) => {
        const selected = selectedPreset === preset.id;

        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(preset.id)}
            className={cn(
              "relative rounded-lg border p-4 text-left transition-colors",
              "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected && "border-foreground bg-muted/40",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{preset.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preset.description}
                </p>
              </div>

              {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default DataroomLayoutPresetCards;
