import { VIEWER_TOGGLE_REQUEST_LIST_EVENT } from "@/ee/features/request-lists/lib/events";
import { ListChecksIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

export function RequestListButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-2", className)}
      onClick={() =>
        window.dispatchEvent(new CustomEvent(VIEWER_TOGGLE_REQUEST_LIST_EVENT))
      }
    >
      <ListChecksIcon className="h-4 w-4" />
      Request List
    </Button>
  );
}
