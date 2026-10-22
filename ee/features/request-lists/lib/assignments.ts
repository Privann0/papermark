export type RequestListAssignment = {
  viewerId?: string | null;
  groupId?: string | null;
  linkId?: string | null;
  email?: string | null;
};

export type RequestListViewerIdentity = {
  viewerId?: string | null;
  linkId?: string | null;
  email?: string | null;
  groupIds: Set<string>;
};

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

/**
 * Returns whether a viewer matches at least one assignment on a request.
 *
 * A task can be assigned directly to:
 * - a viewer
 * - a viewer group
 * - a link
 * - an email address
 *
 * TaskAssignment rows are expected to target exactly one of those identities.
 */
export function isViewerAssigned(
  assignments: RequestListAssignment[],
  viewer: RequestListViewerIdentity,
): boolean {
  if (!assignments.length) return false;

  const viewerEmail = normalizeEmail(viewer.email);

  return assignments.some((assignment) => {
    if (
      assignment.viewerId &&
      viewer.viewerId &&
      assignment.viewerId === viewer.viewerId
    ) {
      return true;
    }

    if (assignment.groupId && viewer.groupIds.has(assignment.groupId)) {
      return true;
    }

    if (
      assignment.linkId &&
      viewer.linkId &&
      assignment.linkId === viewer.linkId
    ) {
      return true;
    }

    const assignmentEmail = normalizeEmail(assignment.email);
    if (assignmentEmail && viewerEmail && assignmentEmail === viewerEmail) {
      return true;
    }

    return false;
  });
}
