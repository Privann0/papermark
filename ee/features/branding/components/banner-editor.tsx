import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BannerEditorProps = {
  banner: string | null;
  setBanner: (value: string | null) => void;
  setBannerBlobUrl: (value: string | null) => void;
  sizeHint?: string;
  defaultBannerImage?: string;
  onUrlApplied?: () => void;
  dropZone: ReactNode;
};

function remoteBannerUrl(value: string | null): string {
  if (!value || value === "no-banner" || value.startsWith("data:")) return "";
  return /^https?:\/\//i.test(value) ? value : "";
}

export function BannerEditor({
  banner,
  setBanner,
  setBannerBlobUrl,
  sizeHint,
  defaultBannerImage,
  onUrlApplied,
  dropZone,
}: BannerEditorProps) {
  const [url, setUrl] = useState(() => remoteBannerUrl(banner));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(remoteBannerUrl(banner));
  }, [banner]);

  const applyUrl = () => {
    const value = url.trim();

    if (!value) {
      setError("Enter an image or video URL.");
      return;
    }

    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      setError("Enter a valid http or https URL.");
      return;
    }

    setError(null);
    setBanner(value);
    setBannerBlobUrl(null);
    onUrlApplied?.();
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="branding-banner-url">Banner</Label>
        {sizeHint ? (
          <p className="mt-1 text-xs text-muted-foreground">{sizeHint}</p>
        ) : null}
      </div>

      {dropZone}

      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            id="branding-banner-url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyUrl();
              }
            }}
            placeholder="https://example.com/banner.jpg"
          />
          <Button type="button" variant="outline" onClick={applyUrl}>
            Use URL
          </Button>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {defaultBannerImage ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setError(null);
              setUrl(defaultBannerImage);
              setBanner(defaultBannerImage);
              setBannerBlobUrl(null);
              onUrlApplied?.();
            }}
          >
            Restore default banner
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default BannerEditor;
