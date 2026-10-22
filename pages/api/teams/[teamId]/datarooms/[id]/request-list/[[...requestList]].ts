import type { NextApiRequest, NextApiResponse } from "next";

import {
  CreateRequestTaskSchema,
  RequestTaskAssignmentInput,
  UpdateRequestTaskSchema,
} from "@/ee/features/request-lists/lib/validation";
import type { Prisma } from "@prisma/client";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { getFeatureFlags } from "@/lib/featureFlags";
import { isRequestListEnabled } from "@/lib/featureFlags/request-list";
import prisma from "@/lib/prisma";
import { scheduleDataroomTaskNotification } from "@/lib/trigger/dataroom-task-notification";

class RequestListApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getPath(req: NextApiRequest): string[] {
  const value = req.query.requestList;

  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) return [value];

  return [];
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseDueDate(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RequestListApiError(400, "Invalid due date");
  }

  return date;
}

function normalizeAssignments(
  assignments: RequestTaskAssignmentInput[],
): RequestTaskAssignmentInput[] {
  const result: RequestTaskAssignmentInput[] = [];
  const seen = new Set<string>();

  for (const assignment of assignments) {
    let key: string;
    let normalized: RequestTaskAssignmentInput;

    switch (assignment.kind) {
      case "viewer":
        key = `viewer:${assignment.viewerId}`;
        normalized = assignment;
        break;

      case "group":
        key = `group:${assignment.groupId}`;
        normalized = assignment;
        break;

      case "link":
        key = `link:${assignment.linkId}`;
        normalized = assignment;
        break;

      case "email": {
        const email = assignment.email.trim().toLowerCase();
        key = `email:${email}`;
        normalized = {
          kind: "email",
          email,
        };
        break;
      }
    }

    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

async function ensureFeatureEnabled(
  teamId: string,
  teamPlan: string,
): Promise<void> {
  const flags = await getFeatureFlags({ teamId });

  if (
    !isRequestListEnabled({
      requestListFlag: flags.requestList,
      teamPlan,
    })
  ) {
    throw new RequestListApiError(
      403,
      "Request List is not available for this team",
    );
  }
}

async function ensureDataroom(
  teamId: string,
  dataroomId: string,
): Promise<void> {
  const dataroom = await prisma.dataroom.findFirst({
    where: {
      id: dataroomId,
      teamId,
    },
    select: {
      id: true,
    },
  });

  if (!dataroom) {
    throw new RequestListApiError(404, "Dataroom not found");
  }
}

async function validateAssignments(
  tx: Prisma.TransactionClient,
  {
    assignments,
    teamId,
    dataroomId,
  }: {
    assignments: RequestTaskAssignmentInput[];
    teamId: string;
    dataroomId: string;
  },
) {
  const normalized = normalizeAssignments(assignments);

  const viewerIds = normalized
    .filter(
      (
        assignment,
      ): assignment is Extract<
        RequestTaskAssignmentInput,
        { kind: "viewer" }
      > => assignment.kind === "viewer",
    )
    .map((assignment) => assignment.viewerId);

  const groupIds = normalized
    .filter(
      (
        assignment,
      ): assignment is Extract<RequestTaskAssignmentInput, { kind: "group" }> =>
        assignment.kind === "group",
    )
    .map((assignment) => assignment.groupId);

  const linkIds = normalized
    .filter(
      (
        assignment,
      ): assignment is Extract<RequestTaskAssignmentInput, { kind: "link" }> =>
        assignment.kind === "link",
    )
    .map((assignment) => assignment.linkId);

  const [viewers, groups, links] = await Promise.all([
    viewerIds.length
      ? tx.viewer.findMany({
          where: {
            id: { in: viewerIds },
            teamId,
            views: {
              some: {
                dataroomId,
                viewType: "DATAROOM_VIEW",
              },
            },
          },
          select: { id: true },
        })
      : Promise.resolve([]),

    groupIds.length
      ? tx.viewerGroup.findMany({
          where: {
            id: { in: groupIds },
            dataroomId,
            teamId,
          },
          select: { id: true },
        })
      : Promise.resolve([]),

    linkIds.length
      ? tx.link.findMany({
          where: {
            id: { in: linkIds },
            dataroomId,
            teamId,
            deletedAt: null,
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  if (viewers.length !== viewerIds.length) {
    throw new RequestListApiError(
      400,
      "One or more assigned viewers are invalid",
    );
  }

  if (groups.length !== groupIds.length) {
    throw new RequestListApiError(
      400,
      "One or more assigned groups are invalid",
    );
  }

  if (links.length !== linkIds.length) {
    throw new RequestListApiError(
      400,
      "One or more assigned links are invalid",
    );
  }

  return normalized.map((assignment) => {
    switch (assignment.kind) {
      case "viewer":
        return { viewerId: assignment.viewerId };

      case "group":
        return { groupId: assignment.groupId };

      case "link":
        return { linkId: assignment.linkId };

      case "email":
        return { email: assignment.email };
    }
  });
}

async function validateUploadFolder(
  tx: Prisma.TransactionClient,
  dataroomId: string,
  uploadFolderId: string | null,
): Promise<string | null> {
  if (!uploadFolderId) return null;

  const folder = await tx.dataroomFolder.findFirst({
    where: {
      id: uploadFolderId,
      dataroomId,
    },
    select: {
      id: true,
    },
  });

  if (!folder) {
    throw new RequestListApiError(400, "Invalid upload folder");
  }

  return folder.id;
}

async function getDefaultList(teamId: string, dataroomId: string) {
  return prisma.taskList.findFirst({
    where: {
      teamId,
      dataroomId,
    },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      tasks: {
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          uploadFolder: {
            select: {
              id: true,
              name: true,
              path: true,
            },
          },
          assignments: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              viewer: {
                select: {
                  id: true,
                  email: true,
                },
              },
              group: {
                select: {
                  id: true,
                  name: true,
                },
              },
              link: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
          _count: {
            select: {
              uploads: true,
              activities: true,
            },
          },
        },
      },
    },
  });
}

async function getTask(teamId: string, dataroomId: string, taskId: string) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      teamId,
      dataroomId,
    },
    include: {
      uploadFolder: {
        select: {
          id: true,
          name: true,
          path: true,
        },
      },
      assignments: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          viewer: {
            select: {
              id: true,
              email: true,
            },
          },
          group: {
            select: {
              id: true,
              name: true,
            },
          },
          link: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
      _count: {
        select: {
          uploads: true,
          activities: true,
        },
      },
    },
  });
}

function handleError(error: unknown, res: NextApiResponse) {
  if (error instanceof RequestListApiError) {
    return res.status(error.status).json({
      error: error.message,
    });
  }

  console.error("Request List API error:", error);
  return res.status(500).json({
    error: "Internal server error",
  });
}

const readHandler = withTeamApi(
  async ({ req, res, teamId, team }) => {
    const { id: dataroomId } = req.query as {
      id: string;
    };

    try {
      await ensureFeatureEnabled(teamId, team.plan);
      await ensureDataroom(teamId, dataroomId);

      const path = getPath(req);

      if (path.length !== 0) {
        return res.status(404).json({ error: "Not found" });
      }

      const list = await getDefaultList(teamId, dataroomId);

      return res.status(200).json({
        list: list
          ? {
              id: list.id,
              name: list.name,
              orderIndex: list.orderIndex,
            }
          : null,
        tasks: list?.tasks ?? [],
      });
    } catch (error) {
      return handleError(error, res);
    }
  },
  {
    requiredPermissions: ["datarooms.read"],
    dataroomParam: "id",
  },
);

const writeHandler = withTeamApi(
  async ({ req, res, teamId, team, userId }) => {
    const { id: dataroomId } = req.query as {
      id: string;
    };

    try {
      await ensureFeatureEnabled(teamId, team.plan);
      await ensureDataroom(teamId, dataroomId);

      const path = getPath(req);

      if (req.method === "POST") {
        if (path.length !== 0) {
          return res.status(404).json({ error: "Not found" });
        }

        const parsed = CreateRequestTaskSchema.safeParse(req.body);

        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid request",
            details: parsed.error.flatten(),
          });
        }

        const input = parsed.data;

        const taskId = await prisma.$transaction(async (tx) => {
          let taskList = await tx.taskList.findFirst({
            where: {
              teamId,
              dataroomId,
            },
            orderBy: [
              { orderIndex: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            select: {
              id: true,
            },
          });

          if (!taskList) {
            taskList = await tx.taskList.create({
              data: {
                name: "Request List",
                orderIndex: 0,
                teamId,
                dataroomId,
              },
              select: {
                id: true,
              },
            });
          }

          const assignmentData = await validateAssignments(tx, {
            assignments: input.assignments,
            teamId,
            dataroomId,
          });

          const uploadFolderId =
            input.type === "UPLOAD"
              ? await validateUploadFolder(
                  tx,
                  dataroomId,
                  input.uploadFolderId ?? null,
                )
              : null;

          const maxOrder = await tx.task.aggregate({
            where: {
              taskListId: taskList.id,
            },
            _max: {
              orderIndex: true,
            },
          });

          const task = await tx.task.create({
            data: {
              title: input.title,
              description: normalizeNullableText(input.description) ?? null,
              type: input.type,
              status: input.status,
              category: normalizeNullableText(input.category) ?? null,
              dueDate: parseDueDate(input.dueDate) ?? null,
              orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
              taskListId: taskList.id,
              dataroomId,
              teamId,
              uploadFolderId,
              createdByUserId: userId,
              assignments: {
                create: assignmentData,
              },
              activities: {
                create: [
                  {
                    type: "CREATED",
                    userId,
                  },
                  ...(assignmentData.length > 0
                    ? [
                        {
                          type: "ASSIGNED",
                          userId,
                        },
                      ]
                    : []),
                ],
              },
            },
            select: {
              id: true,
            },
          });

          return task.id;
        });

        const task = await getTask(teamId, dataroomId, taskId);

        return res.status(201).json({ task });
      }

      if (req.method === "PATCH") {
        if (path.length !== 1) {
          return res.status(404).json({ error: "Not found" });
        }

        const taskId = path[0];
        const existing = await prisma.task.findFirst({
          where: {
            id: taskId,
            teamId,
            dataroomId,
          },
          select: {
            id: true,
            type: true,
            status: true,
            uploadFolderId: true,
          },
        });

        if (!existing) {
          throw new RequestListApiError(404, "Request not found");
        }

        const parsed = UpdateRequestTaskSchema.safeParse(req.body);

        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid request",
            details: parsed.error.flatten(),
          });
        }

        const input = parsed.data;

        await prisma.$transaction(async (tx) => {
          const resultingType = input.type ?? existing.type;

          const assignmentData =
            input.assignments !== undefined
              ? await validateAssignments(tx, {
                  assignments: input.assignments,
                  teamId,
                  dataroomId,
                })
              : undefined;

          let uploadFolderId: string | null | undefined;

          if (resultingType !== "UPLOAD") {
            uploadFolderId = null;
          } else if (input.uploadFolderId !== undefined) {
            uploadFolderId = await validateUploadFolder(
              tx,
              dataroomId,
              input.uploadFolderId,
            );
          }

          const nextStatus = input.status ?? existing.status;
          const statusChanged = nextStatus !== existing.status;

          await tx.task.update({
            where: {
              id: taskId,
            },
            data: {
              ...(input.title !== undefined && {
                title: input.title,
              }),
              ...(input.description !== undefined && {
                description: normalizeNullableText(input.description) ?? null,
              }),
              ...(input.type !== undefined && {
                type: input.type,
              }),
              ...(input.status !== undefined && {
                status: input.status,
              }),
              ...(input.category !== undefined && {
                category: normalizeNullableText(input.category) ?? null,
              }),
              ...(input.dueDate !== undefined && {
                dueDate: parseDueDate(input.dueDate) ?? null,
              }),
              ...(uploadFolderId !== undefined && {
                uploadFolderId,
              }),
              ...(assignmentData !== undefined && {
                assignments: {
                  deleteMany: {},
                  create: assignmentData,
                },
              }),
              activities: {
                create: [
                  ...(statusChanged
                    ? [
                        {
                          type: "STATUS_CHANGED",
                          userId,
                          fromStatus: existing.status,
                          toStatus: nextStatus,
                        },
                      ]
                    : []),
                  ...(assignmentData !== undefined
                    ? [
                        {
                          type: "ASSIGNED",
                          userId,
                        },
                      ]
                    : []),
                ],
              },
            },
          });
        });

        if (input.status !== undefined && input.status !== existing.status) {
          try {
            await scheduleDataroomTaskNotification({
              taskId,
              dataroomId,
              teamId,
            });
          } catch (error) {
            console.error(
              "Failed to schedule Request List activity notification:",
              error,
            );
          }
        }

        const task = await getTask(teamId, dataroomId, taskId);

        return res.status(200).json({ task });
      }

      if (req.method === "DELETE") {
        if (path.length !== 1) {
          return res.status(404).json({ error: "Not found" });
        }

        const taskId = path[0];

        const result = await prisma.task.deleteMany({
          where: {
            id: taskId,
            teamId,
            dataroomId,
          },
        });

        if (result.count !== 1) {
          throw new RequestListApiError(404, "Request not found");
        }

        return res.status(204).end();
      }

      res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    } catch (error) {
      return handleError(error, res);
    }
  },
  {
    requiredPermissions: ["datarooms.write"],
    dataroomParam: "id",
  },
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return readHandler(req, res);
  }

  if (
    req.method === "POST" ||
    req.method === "PATCH" ||
    req.method === "DELETE"
  ) {
    return writeHandler(req, res);
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
