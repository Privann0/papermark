type BrandingSocialPreviewReadonlyProps = {
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
};

function backgroundImage(url: string | null) {
  return url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined;
}

export function BrandingSocialPreviewReadonly({
  title,
  description,
  image,
  favicon,
}: BrandingSocialPreviewReadonlyProps) {
  return (
    <div className="w-full overflow-hidden rounded-xl border bg-card shadow-sm">
      <div
        role="img"
        aria-label="Shared link preview"
        className="aspect-[1.91/1] w-full bg-muted bg-cover bg-center"
        style={backgroundImage(image)}
      >
        {!image ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Preview image
          </div>
        ) : null}
      </div>

      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {favicon ? (
            <span
              role="img"
              aria-label="Favicon"
              className="h-4 w-4 shrink-0 rounded-sm bg-contain bg-center bg-no-repeat"
              style={backgroundImage(favicon)}
            />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-sm bg-muted" />
          )}
          <span>Shared link preview</span>
        </div>

        <div>
          <p className="line-clamp-2 text-sm font-medium">
            {title || "Your link preview title"}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
            {description ||
              "Your custom description will appear here when this link is shared."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default BrandingSocialPreviewReadonly;
