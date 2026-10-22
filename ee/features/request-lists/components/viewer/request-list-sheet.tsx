import { useState } from "react";

import { useViewerRequestList } from "@/ee/features/request-lists/lib/swr/use-viewer-request-list";
import {
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  FileUpIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ViewerUploadComponent } from "@/components/viewer-upload-component";

type RequestListSheetProps = {
  linkId: string;
  dataroomId: string;
  viewId: string;
  viewerId?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

function getStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "Open";
    case "IN_PROGRESS":
      return "In progress";
    case "SUBMITTED":
      return "Submitted";
    case "COMPLETED":
      return "Completed";
    default:
      return status;
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "UPLOAD":
      return "Upload";
    case "ACKNOWLEDGE":
      return "Acknowledge";
    case "TODO":
      return "To do";
    default:
      return type;
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return <CheckCircle2Icon className="h-4 w-4 shrink-0" />;
  }

  if (status === "SUBMITTED" || status === "IN_PROGRESS") {
    return <Clock3Icon className="h-4 w-4 shrink-0" />;
  }

  return <CircleIcon className="h-4 w-4 shrink-0" />;
}

function formatDueDate(value: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function RequestListSheet({
  linkId,
  dataroomId,
  viewId,
  viewerId,
  isOpen,
  onOpenChange,
}: RequestListSheetProps) {
  const { enabled, teamId, list, tasks, isLoading, error, mutate } =
    useViewerRequestList({
      linkId,
      dataroomId,
      viewerId,
      isPreview: false,
    });

  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const completeTask = async (taskId: string) => {
    if (!viewerId) return;

    setCompletingTaskId(taskId);

    try {
      const response = await fetch(
        `/api/links/${encodeURIComponent(linkId)}/request-list`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dataroomId,
            taskId,
            action: "complete",
          }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Failed to update request");
      }

      await mutate();
    } catch (error) {
      console.error("Error completing Request List task:", error);
    } finally {
      setCompletingTaskId(null);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        data-view-id={viewId || undefined}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ListChecksIcon className="h-5 w-5" />
            {list?.name || "Request List"}
          </SheetTitle>

          <SheetDescription>
            Review the requests assigned to you and provide the requested
            information or files.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {isLoading && (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Unable to load the Request List.
            </div>
          )}

          {!isLoading && !error && (!enabled || tasks.length === 0) && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <ListChecksIcon className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No requests assigned</p>
              <p className="mt-1 text-xs text-muted-foreground">
                There are currently no Request List items assigned to you.
              </p>
            </div>
          )}

          {!isLoading &&
            !error &&
            enabled &&
            tasks.map((task) => {
              const dueDate = formatDueDate(task.dueDate);

              return (
                <div
                  key={task.id}
                  className="overflow-hidden rounded-lg border bg-background"
                >
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-start gap-2">
                          <StatusIcon status={task.status} />
                          <p className="break-words text-sm font-medium">
                            {task.title}
                          </p>
                        </div>

                        {task.description && (
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {task.description}
                          </p>
                        )}
                      </div>

                      <Badge variant="outline" className="shrink-0">
                        {getStatusLabel(task.status)}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">
                        {getTypeLabel(task.type)}
                      </Badge>

                      {task.category && <span>{task.category}</span>}

                      {dueDate && <span>Due {dueDate}</span>}

                      {task.type === "UPLOAD" && task.uploadCount > 0 && (
                        <span>
                          {task.uploadCount} file
                          {task.uploadCount === 1 ? "" : "s"} uploaded
                        </span>
                      )}
                    </div>
                  </div>

                  {task.type === "UPLOAD" &&
                    task.status !== "COMPLETED" &&
                    teamId &&
                    viewerId && (
                      <div className="border-t bg-muted/20">
                        <div className="flex items-center gap-2 px-4 pt-4 text-sm font-medium">
                          <FileUpIcon className="h-4 w-4" />
                          Upload requested files
                        </div>

                        <ViewerUploadComponent
                          viewerData={{
                            id: viewerId,
                            linkId,
                            dataroomId,
                          }}
                          teamId={teamId}
                          taskId={task.id}
                          onUploadSuccess={() => {
                            void mutate();
                          }}
                        />
                      </div>
                    )}

                  {(task.type === "TODO" || task.type === "ACKNOWLEDGE") &&
                    task.status !== "COMPLETED" && (
                      <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                          {task.type === "ACKNOWLEDGE"
                            ? "Confirm that you acknowledge this request."
                            : "Mark this request complete when it is done."}
                        </p>

                        <Button
                          type="button"
                          size="sm"
                          disabled={!viewerId || completingTaskId === task.id}
                          onClick={() => {
                            void completeTask(task.id);
                          }}
                        >
                          {completingTaskId === task.id ? (
                            <>
                              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                              Updating...
                            </>
                          ) : task.type === "ACKNOWLEDGE" ? (
                            "Acknowledge"
                          ) : (
                            "Mark complete"
                          )}
                        </Button>
                      </div>
                    )}
                </div>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
