import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const DRAFT_TEAM_BRAND_ID = "__draft_team_brand__";

type TeamBrand = {
  id: string;
  name?: string | null;
};

type TeamBrandSwitcherProps = {
  brands: TeamBrand[];
  selectedBrandId: string | null;
  defaultBrandId: string | null;
  brandName: string;
  onBrandNameChange: (value: string) => void;
  onSelect: (brandId: string | null) => void;
  onCreate: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  disabled?: boolean;
};

export function nextTeamBrandName(brands: TeamBrand[]): string {
  const names = new Set(
    brands
      .map((brand) => brand.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );

  let index = Math.max(1, brands.length + 1);
  while (names.has(`Brand ${index}`)) index += 1;

  return `Brand ${index}`;
}

export function TeamBrandSwitcher({
  brands,
  selectedBrandId,
  defaultBrandId,
  brandName,
  onBrandNameChange,
  onSelect,
  onCreate,
  onSetDefault,
  onDelete,
  disabled = false,
}: TeamBrandSwitcherProps) {
  const isDraft = selectedBrandId === DRAFT_TEAM_BRAND_ID;
  const isDefault =
    Boolean(selectedBrandId) && !isDraft && selectedBrandId === defaultBrandId;
  const canActOnPersistedBrand = Boolean(selectedBrandId) && !isDraft;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="team-brand-select">Brand</Label>
          <select
            id="team-brand-select"
            value={selectedBrandId ?? ""}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value || null)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>
              Select a brand
            </option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name?.trim() || "Untitled brand"}
                {brand.id === defaultBrandId ? " (Default)" : ""}
              </option>
            ))}
            {isDraft ? (
              <option value={DRAFT_TEAM_BRAND_ID}>New brand</option>
            ) : null}
          </select>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus className="mr-2 h-4 w-4" />
          New brand
        </Button>
      </div>

      {selectedBrandId ? (
        <div className="mt-4 border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor="team-brand-name">Brand name</Label>
            <Input
              id="team-brand-name"
              value={brandName}
              disabled={disabled}
              onChange={(event) => onBrandNameChange(event.target.value)}
              placeholder="Brand name"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !canActOnPersistedBrand || isDefault}
              onClick={onSetDefault}
            >
              {isDefault ? "Default brand" : "Set as default"}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || !canActOnPersistedBrand}
              onClick={onDelete}
            >
              Delete
            </Button>

            {isDraft ? (
              <span className="text-xs text-muted-foreground">
                This brand will be created when you save.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TeamBrandSwitcher;
