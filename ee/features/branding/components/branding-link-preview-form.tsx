import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type BrandingLinkPreviewFormProps = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  imageUrl: string | null;
  onImageChange: (value: string | null) => void;
  faviconUrl: string | null;
  onFaviconChange: (value: string | null) => void;
  inheritanceHint?: string;
};

export function BrandingLinkPreviewForm({
  enabled,
  onEnabledChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  imageUrl,
  onImageChange,
  faviconUrl,
  onFaviconChange,
  inheritanceHint,
}: BrandingLinkPreviewFormProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="branding-link-preview-enabled">
            Custom Link Preview
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Customize the title, description and artwork shown when a link is
            shared.
          </p>
        </div>

        <Switch
          id="branding-link-preview-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {inheritanceHint ? (
        <p className="text-xs text-muted-foreground">{inheritanceHint}</p>
      ) : null}

      {enabled ? (
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor="branding-link-preview-title">Title</Label>
            <Input
              id="branding-link-preview-title"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Link preview title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branding-link-preview-description">
              Description
            </Label>
            <Textarea
              id="branding-link-preview-description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Short description shown in the shared preview"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branding-link-preview-image">
              Preview image URL
            </Label>
            <Input
              id="branding-link-preview-image"
              value={imageUrl ?? ""}
              onChange={(event) =>
                onImageChange(event.target.value.trim() || null)
              }
              placeholder="https://example.com/social-preview.jpg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branding-link-preview-favicon">Favicon URL</Label>
            <Input
              id="branding-link-preview-favicon"
              value={faviconUrl ?? ""}
              onChange={(event) =>
                onFaviconChange(event.target.value.trim() || null)
              }
              placeholder="https://example.com/favicon.ico"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default BrandingLinkPreviewForm;
