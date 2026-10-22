import { FormEvent, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  CheckCircle2Icon,
  CircleIcon,
  FileUpIcon,
  ListChecksIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TaskType = "TODO" | "UPLOAD" | "ACKNOWLEDGE";
type TaskStatus = "OPEN" | "IN_PROGRESS" | "SUBMITTED" | "COMPLETED";

type Assignment = {
  id: string;
  viewerId: string | null;
  groupId: string | null;
  linkId: string | null;
  email: string | null;
  viewer?: {
    id: string;
    email: string | null;
  } | null;
  group?: {
    id: string;
    name: string;
  } | null;
  link?: {
    id: string;
    name: string | null;
    slug: string | null;
  } | null;
};

type RequestTask = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  category: string | null;
  dueDate: string | null;
  orderIndex: number | null;
  uploadFolderId: string | null;
  uploadFolder?: {
    id: string;
    name: string;
    path: string | null;
  } | null;
  assignments: Assignment[];
  _count: {
    uploads: number;
    activities: number;
  };
};

type RequestListResponse = {
  list: {
    id: string;
    name: string;
    orderIndex: number | null;
  } | null;
  tasks: RequestTask[];
};

type ViewerOption = {
  id: string;
  email: string | null;
  viewerName?: string | null;
};

type GroupOption = {
  id: string;
  name: string;
};

type LinkOption = {
  id: string;
  name: string | null;
  slug: string | null;
};

type FolderOption = {
  id: string;
  name: string;
  path: string | null;
};

const EMPTY_FORM = {
  title: "",
  description: "",
  type: "TODO" as TaskType,
  status: "OPEN" as TaskStatus,
  category: "",
  dueDate: "",
  uploadFolderId: "",
  viewerIds: [] as string[],
  groupIds: [] as string[],
  linkIds: [] as string[],
  emails: "",
};

function getSelectedValues(
  event: React.ChangeEvent<HTMLSelectElement>,
): string[] {
  return Array.from(
    event.currentTarget.selectedOptions,
    (option) => option.value,
  );
}

function parseEmails(value: string): string[] {
  const emails = value
    .split(/[\n,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(emails));
}

function taskTypeLabel(type: string): string {
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

function taskStatusLabel(status: string): string {
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

function assignmentLabel(assignment: Assignment): string {
  if (assignment.viewerId) {
    return assignment.viewer?.email || "Viewer";
  }

  if (assignment.groupId) {
    return assignment.group?.name
      ? `Group: ${assignment.group.name}`
      : "Viewer group";
  }

  if (assignment.linkId) {
    const name = assignment.link?.name || assignment.link?.slug;
    return name ? `Link: ${name}` : "Link";
  }

  if (assignment.email) {
    return assignment.email;
  }

  return "Assignee";
}

export function RequestListView({ dataroomId }: { dataroomId: string }) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const baseUrl = teamId
    ? `/api/teams/${teamId}/datarooms/${dataroomId}`
    : null;

  const requestListUrl = baseUrl ? `${baseUrl}/request-list` : null;

  const { data, error, isLoading, mutate } = useSWR<RequestListResponse>(
    requestListUrl,
    fetcher,
  );

  const { data: viewers } = useSWR<ViewerOption[]>(
    baseUrl ? `${baseUrl}/viewers` : null,
    fetcher,
  );

  const { data: groups } = useSWR<GroupOption[]>(
    baseUrl ? `${baseUrl}/groups` : null,
    fetcher,
  );

  const { data: links } = useSWR<LinkOption[]>(
    baseUrl ? `${baseUrl}/links` : null,
    fetcher,
  );

  const { data: folders } = useSWR<FolderOption[]>(
    baseUrl ? `${baseUrl}/folders` : null,
    fetcher,
  );

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const tasks = data?.tasks ?? [];

  const sortedFolders = useMemo(
    () =>
      [...(folders ?? [])].sort((a, b) =>
        (a.path || a.name).localeCompare(b.path || b.name),
      ),
    [folders],
  );

  const resetForm = () => {
    setEditingTaskId(null);
    setForm({
      ...EMPTY_FORM,
      viewerIds: [],
      groupIds: [],
      linkIds: [],
    });
  };

  const startEditing = (task: RequestTask) => {
    setEditingTaskId(task.id);

    setForm({
      title: task.title,
      description: task.description ?? "",
      type: task.type as TaskType,
      status: task.status as TaskStatus,
      category: task.category ?? "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      uploadFolderId: task.uploadFolderId ?? "",
      viewerIds: task.assignments
        .filter((assignment) => !!assignment.viewerId)
        .map((assignment) => assignment.viewerId!),
      groupIds: task.assignments
        .filter((assignment) => !!assignment.groupId)
        .map((assignment) => assignment.groupId!),
      linkIds: task.assignments
        .filter((assignment) => !!assignment.linkId)
        .map((assignment) => assignment.linkId!),
      emails: task.assignments
        .filter((assignment) => !!assignment.email)
        .map((assignment) => assignment.email!)
        .join(", "),
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!requestListUrl || !form.title.trim()) {
      return;
    }

    setSaving(true);

    try {
      const assignments = [
        ...form.viewerIds.map((viewerId) => ({
          kind: "viewer" as const,
          viewerId,
        })),
        ...form.groupIds.map((groupId) => ({
          kind: "group" as const,
          groupId,
        })),
        ...form.linkIds.map((linkId) => ({
          kind: "link" as const,
          linkId,
        })),
        ...parseEmails(form.emails).map((email) => ({
          kind: "email" as const,
          email,
        })),
      ];

      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        status: form.status,
        category: form.category.trim() || null,
        dueDate: form.dueDate || null,
        uploadFolderId:
          form.type === "UPLOAD" && form.uploadFolderId
            ? form.uploadFolderId
            : null,
        assignments,
      };

      const endpoint = editingTaskId
        ? `${requestListUrl}/${editingTaskId}`
        : requestListUrl;

      const response = await fetch(endpoint, {
        method: editingTaskId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);

        throw new Error(
          body?.error ||
            body?.message ||
            `Failed to ${editingTaskId ? "update" : "create"} request`,
        );
      }

      toast.success(editingTaskId ? "Request updated" : "Request created");

      resetForm();
      await mutate();
    } catch (error) {
      console.error("Error saving Request List task:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save request",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (task: RequestTask) => {
    if (!requestListUrl) return;

    const confirmed = window.confirm(
      `Delete "${task.title}" from the Request List?`,
    );

    if (!confirmed) return;

    setDeletingTaskId(task.id);

    try {
      const response = await fetch(`${requestListUrl}/${task.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);

        throw new Error(
          body?.error || body?.message || "Failed to delete request",
        );
      }

      if (editingTaskId === task.id) {
        resetForm();
      }

      toast.success("Request deleted");
      await mutate();
    } catch (error) {
      console.error("Error deleting Request List task:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete request",
      );
    } finally {
      setDeletingTaskId(null);
    }
  };

  if (!teamId) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border">
        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        Unable to load the Request List.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={submitTask}
        className="space-y-5 rounded-lg border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="flex items-center gap-2 font-semibold">
              {editingTaskId ? (
                <PencilIcon className="h-4 w-4" />
              ) : (
                <PlusIcon className="h-4 w-4" />
              )}
              {editingTaskId ? "Edit request" : "Add request"}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Define the request, its assignees and its completion state.
            </p>
          </div>

          {editingTaskId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetForm}
            >
              Cancel
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label htmlFor="request-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="request-title"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="e.g. FY2025 audited financial statements"
              maxLength={255}
              required
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label
              htmlFor="request-description"
              className="text-sm font-medium"
            >
              Description
            </label>
            <Textarea
              id="request-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Optional details or instructions"
              rows={3}
              maxLength={10000}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="request-type" className="text-sm font-medium">
              Type
            </label>
            <select
              id="request-type"
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  type: event.target.value as TaskType,
                  uploadFolderId:
                    event.target.value === "UPLOAD"
                      ? current.uploadFolderId
                      : "",
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="TODO">To do</option>
              <option value="UPLOAD">Upload</option>
              <option value="ACKNOWLEDGE">Acknowledge</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="request-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="request-status"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as TaskStatus,
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="request-category" className="text-sm font-medium">
              Category
            </label>
            <Input
              id="request-category"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              placeholder="Financial, Legal, Tax..."
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="request-due-date" className="text-sm font-medium">
              Due date
            </label>
            <Input
              id="request-due-date"
              type="date"
              value={form.dueDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueDate: event.target.value,
                }))
              }
            />
          </div>

          {form.type === "UPLOAD" && (
            <div className="space-y-2 md:col-span-2">
              <label
                htmlFor="request-upload-folder"
                className="text-sm font-medium"
              >
                Upload destination
              </label>
              <select
                id="request-upload-folder"
                value={form.uploadFolderId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    uploadFolderId: event.target.value,
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Use the link upload destination</option>
                {sortedFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path || folder.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="border-t pt-5">
          <h5 className="font-medium">Assignments</h5>
          <p className="mt-1 text-xs text-muted-foreground">
            A request may be assigned to multiple viewers, groups, links or
            email addresses.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="request-viewers" className="text-sm font-medium">
                Viewers
              </label>
              <select
                id="request-viewers"
                multiple
                size={5}
                value={form.viewerIds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    viewerIds: getSelectedValues(event),
                  }))
                }
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              >
                {(viewers ?? []).map((viewer) => (
                  <option key={viewer.id} value={viewer.id}>
                    {viewer.viewerName
                      ? `${viewer.viewerName}${
                          viewer.email ? ` (${viewer.email})` : ""
                        }`
                      : viewer.email || viewer.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="request-groups" className="text-sm font-medium">
                Viewer groups
              </label>
              <select
                id="request-groups"
                multiple
                size={5}
                value={form.groupIds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    groupIds: getSelectedValues(event),
                  }))
                }
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              >
                {(groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="request-links" className="text-sm font-medium">
                Links
              </label>
              <select
                id="request-links"
                multiple
                size={5}
                value={form.linkIds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    linkIds: getSelectedValues(event),
                  }))
                }
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              >
                {(links ?? []).map((link) => (
                  <option key={link.id} value={link.id}>
                    {link.name || link.slug || link.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label htmlFor="request-emails" className="text-sm font-medium">
              Email assignments
            </label>
            <Input
              id="request-emails"
              value={form.emails}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  emails: event.target.value,
                }))
              }
              placeholder="alice@example.com, bob@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple email addresses with commas, semicolons or new
              lines.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-5">
          {editingTaskId && (
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </Button>
          )}

          <Button type="submit" disabled={saving || !form.title.trim()}>
            {saving && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            {editingTaskId ? "Save changes" : "Add request"}
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-semibold">
              {data?.list?.name || "Request List"}
            </h4>
            <p className="text-sm text-muted-foreground">
              {tasks.length} request{tasks.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <ListChecksIcon className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
            <p className="font-medium">No requests yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the first request using the form above.
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {task.status === "COMPLETED" ? (
                      <CheckCircle2Icon className="h-4 w-4 text-muted-foreground" />
                    ) : task.type === "UPLOAD" ? (
                      <FileUpIcon className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <CircleIcon className="h-4 w-4 text-muted-foreground" />
                    )}

                    <h5 className="font-medium">{task.title}</h5>

                    <Badge variant="secondary">
                      {taskTypeLabel(task.type)}
                    </Badge>

                    <Badge variant="outline">
                      {taskStatusLabel(task.status)}
                    </Badge>
                  </div>

                  {task.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {task.description}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {task.category && <span>Category: {task.category}</span>}

                    {task.dueDate && (
                      <span>
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}

                    {task.uploadFolder && (
                      <span>
                        Upload to:{" "}
                        {task.uploadFolder.path || task.uploadFolder.name}
                      </span>
                    )}

                    {task.type === "UPLOAD" && (
                      <span>
                        {task._count.uploads} upload
                        {task._count.uploads === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {task.assignments.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No assignees
                      </span>
                    ) : (
                      task.assignments.map((assignment) => (
                        <Badge key={assignment.id} variant="outline">
                          {assignmentLabel(assignment)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startEditing(task)}
                  >
                    <PencilIcon className="mr-2 h-4 w-4" />
                    Edit
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={deletingTaskId === task.id}
                    onClick={() => {
                      void deleteTask(task);
                    }}
                  >
                    {deletingTaskId === task.id ? (
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="mr-2 h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
