import { NextRequest, NextResponse } from "next/server";

import { isViewerAssigned } from "@/ee/features/request-lists/lib/assignments";
import { waitUntil } from "@vercel/functions";

import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { resolveRequestListEnabled } from "@/lib/featureFlags/request-list";
import prisma from "@/lib/prisma";
import { scheduleDataroomTaskNotification } from "@/lib/trigger/dataroom-task-notification";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const dataroomId = request.nextUrl.searchParams.get("dataroomId");
    const requestedViewerId = request.nextUrl.searchParams.get("viewerId");

    if (!linkId || !dataroomId || !requestedViewerId) {
      return NextResponse.json(
        { message: "Missing required parameters" },
        { status: 400 },
      );
    }

    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (
      !dataroomSession?.viewerId ||
      dataroomSession.viewerId !== requestedViewerId
    ) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const link = await prisma.link.findUnique({
      where: {
        id: linkId,
        dataroomId,
      },
      select: {
        id: true,
        teamId: true,
      },
    });

    if (!link?.teamId) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

    const dataroom = await prisma.dataroom.findFirst({
      where: {
        id: dataroomId,
        teamId: link.teamId,
      },
      select: {
        requestListEnabled: true,
        team: {
          select: {
            plan: true,
          },
        },
      },
    });

    if (!dataroom) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

    if (!dataroom.requestListEnabled) {
      return NextResponse.json({
        enabled: false,
        teamId: link.teamId,
        list: null,
        tasks: [],
      });
    }

    const featureEnabled = await resolveRequestListEnabled({
      teamId: link.teamId,
      teamPlan: dataroom.team.plan,
    });

    if (!featureEnabled) {
      return NextResponse.json({
        enabled: false,
        teamId: link.teamId,
        list: null,
        tasks: [],
      });
    }

    const viewer = await prisma.viewer.findUnique({
      where: {
        id: dataroomSession.viewerId,
        teamId: link.teamId,
        views: {
          some: {
            id: dataroomSession.viewId,
          },
        },
      },
      select: {
        id: true,
        email: true,
        groups: {
          select: {
            groupId: true,
          },
        },
      },
    });

    if (!viewer) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Public viewers use one default Request List: the list with the lowest
    // orderIndex. createdAt/id provide deterministic ordering for null/ties.
    const taskList = await prisma.taskList.findFirst({
      where: {
        dataroomId,
        teamId: link.teamId,
      },
      orderBy: [
        {
          orderIndex: "asc",
        },
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
      select: {
        id: true,
        name: true,
        tasks: {
          orderBy: [
            {
              orderIndex: "asc",
            },
            {
              createdAt: "asc",
            },
            {
              id: "asc",
            },
          ],
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            status: true,
            category: true,
            dueDate: true,
            orderIndex: true,
            assignments: {
              select: {
                viewerId: true,
                groupId: true,
                linkId: true,
                email: true,
              },
            },
            uploads: {
              where: {
                viewerId: viewer.id,
              },
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!taskList) {
      return NextResponse.json({
        enabled: false,
        teamId: link.teamId,
        list: null,
        tasks: [],
      });
    }

    const identity = {
      viewerId: viewer.id,
      email: viewer.email ?? null,
      linkId,
      groupIds: new Set(viewer.groups.map((group) => group.groupId)),
    };

    const tasks = taskList.tasks
      .filter((task) => isViewerAssigned(task.assignments, identity))
      .map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        status: task.status,
        category: task.category,
        dueDate: task.dueDate?.toISOString() ?? null,
        orderIndex: task.orderIndex,
        uploadCount: task.uploads.length,
      }));

    return NextResponse.json({
      // Do not expose an empty Request List trigger to viewers with no assigned
      // work. Assignment changes become visible on normal SWR revalidation.
      enabled: tasks.length > 0,
      teamId: link.teamId,
      list:
        tasks.length > 0
          ? {
              id: taskList.id,
              name: taskList.name,
            }
          : null,
      tasks,
    });
  } catch (error) {
    console.error("Error fetching viewer request list:", error);
    return NextResponse.json(
      { message: "Error fetching request list" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/links/[id]/request-list
 *
 * Viewer action for non-upload Request List tasks.
 *
 * Body:
 *   {
 *     dataroomId: string;
 *     taskId: string;
 *     action: "complete";
 *   }
 *
 * TODO and ACKNOWLEDGE tasks transition to COMPLETED. The actor is derived
 * exclusively from the verified dataroom session, never from client-supplied
 * viewer identity.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const body = (await request.json()) as {
      dataroomId?: string;
      taskId?: string;
      action?: string;
    };

    const dataroomId = body.dataroomId?.trim();
    const taskId = body.taskId?.trim();

    if (!linkId || !dataroomId || !taskId || body.action !== "complete") {
      return NextResponse.json(
        { message: "Invalid Request List action" },
        { status: 400 },
      );
    }

    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (!dataroomSession || !dataroomSession.viewerId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const link = await prisma.link.findUnique({
      where: {
        id: linkId,
        dataroomId,
      },
      select: {
        id: true,
        teamId: true,
      },
    });

    if (!link?.teamId) {
      return NextResponse.json({ message: "Link not found" }, { status: 404 });
    }

    const teamId = link.teamId;

    const dataroom = await prisma.dataroom.findFirst({
      where: {
        id: dataroomId,
        teamId,
      },
      select: {
        requestListEnabled: true,
        team: {
          select: {
            plan: true,
          },
        },
      },
    });

    if (!dataroom || !dataroom.requestListEnabled) {
      return NextResponse.json(
        { message: "Request List is not enabled" },
        { status: 403 },
      );
    }

    const featureEnabled = await resolveRequestListEnabled({
      teamId,
      teamPlan: dataroom.team.plan,
    });

    if (!featureEnabled) {
      return NextResponse.json(
        { message: "Request List is not available" },
        { status: 403 },
      );
    }

    const viewer = await prisma.viewer.findUnique({
      where: {
        id: dataroomSession.viewerId,
        teamId,
        views: {
          some: {
            id: dataroomSession.viewId,
          },
        },
      },
      select: {
        id: true,
        email: true,
        groups: {
          select: {
            groupId: true,
          },
        },
      },
    });

    if (!viewer) {
      return NextResponse.json(
        { message: "Viewer not found" },
        { status: 404 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: {
          id: taskId,
          dataroomId,
          teamId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          assignments: {
            select: {
              viewerId: true,
              groupId: true,
              linkId: true,
              email: true,
            },
          },
        },
      });

      if (!task) {
        return {
          kind: "not_found" as const,
        };
      }

      const assigned = isViewerAssigned(task.assignments, {
        viewerId: viewer.id,
        linkId,
        email: viewer.email ?? null,
        groupIds: new Set(viewer.groups.map((group) => group.groupId)),
      });

      if (!assigned) {
        return {
          kind: "forbidden" as const,
        };
      }

      if (task.type !== "TODO" && task.type !== "ACKNOWLEDGE") {
        return {
          kind: "wrong_type" as const,
        };
      }

      if (task.status === "COMPLETED") {
        return {
          kind: "ok" as const,
          status: "COMPLETED",
          changed: false,
        };
      }

      // Conditional update keeps repeated/concurrent completion requests
      // idempotent and prevents duplicate STATUS_CHANGED activities.
      const update = await tx.task.updateMany({
        where: {
          id: task.id,
          status: task.status,
        },
        data: {
          status: "COMPLETED",
        },
      });

      if (update.count === 0) {
        const current = await tx.task.findUnique({
          where: {
            id: task.id,
          },
          select: {
            status: true,
          },
        });

        return {
          kind: "ok" as const,
          status: current?.status ?? task.status,
          changed: false,
        };
      }

      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          type: "STATUS_CHANGED",
          fromStatus: task.status,
          toStatus: "COMPLETED",
          viewerId: viewer.id,
          viewId: dataroomSession.viewId || null,
        },
      });

      return {
        kind: "ok" as const,
        status: "COMPLETED",
        changed: true,
      };
    });

    if (result.kind === "not_found") {
      return NextResponse.json(
        { message: "Request not found" },
        { status: 404 },
      );
    }

    if (result.kind === "forbidden") {
      return NextResponse.json(
        { message: "Request is not assigned to this viewer" },
        { status: 403 },
      );
    }

    if (result.kind === "wrong_type") {
      return NextResponse.json(
        { message: "This request cannot be completed with this action" },
        { status: 400 },
      );
    }

    if (result.changed) {
      waitUntil(
        scheduleDataroomTaskNotification({
          taskId,
          dataroomId,
          teamId,
        }).catch((error) => {
          console.error(
            "Failed to schedule Request List activity notification:",
            error,
          );
        }),
      );
    }

    return NextResponse.json({
      taskId,
      status: result.status,
      changed: result.changed,
    });
  } catch (error) {
    console.error("Error updating viewer Request List task:", error);

    return NextResponse.json(
      { message: "Error updating Request List task" },
      { status: 500 },
    );
  }
}
