import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

import { useViewerSurfaceTheme } from "@/components/view/viewer/viewer-surface-theme";

export function DataroomNoBannerTitle({
  name,
  lastUpdatedAt,
  showLastUpdated,
  className,
}: {
  name: string;
  lastUpdatedAt?: Date | string | null;
  showLastUpdated?: boolean;
  className?: string;
}) {
  const { usesLightText, palette } = useViewerSurfaceTheme();

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "text-3xl",
          !usesLightText && "text-foreground",
        )}
        style={usesLightText ? { color: palette.textColor } : undefined}
      >
        {name}
      </div>
      {showLastUpdated && lastUpdatedAt ? (
        <time
          className={cn(
            "mt-0.5 block text-sm",
            !usesLightText && "text-muted-foreground",
          )}
          dateTime={new Date(lastUpdatedAt).toISOString()}
          style={
            usesLightText ? { color: palette.mutedTextColor } : undefined
          }
        >
          {`Last updated ${formatDate(new Date(lastUpdatedAt).toISOString())}`}
        </time>
      ) : null}
    </div>
  );
}
