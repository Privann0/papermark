import { logger, runs, task } from "@trigger.dev/sdk";

import { sendDataroomTaskNotification } from "@/lib/emails/send-dataroom-task-notification";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import prisma from "@/lib/prisma";

type DataroomTaskNotificationPayload = {
  taskId: string;
  dataroomId: string;
  teamId: string;
};

const NOTIFIABLE_ACTIVITY_TYPES = ["COMMENT", "UPLOADED", "STATUS_CHANGED"];

function activityToLine(activity: {
  type: string;
  comment: string | null;
  fromStatus: string | null;
  toStatus: string | null;
}): string {
  switch (activity.type) {
    case "UPLOADED":
      return "A viewer uploaded a file for this request.";

    case "STATUS_CHANGED": {
      if (activity.fromStatus && activity.toStatus) {
        return `Status changed from ${activity.fromStatus} to ${activity.toStatus}.`;
      }

      return "The request status changed.";
    }

    case "COMMENT": {
      const comment = activity.comment?.trim();

      if (!comment) {
        return "A new comment was added.";
      }

      const shortened =
        comment.length > 500 ? `${comment.slice(0, 497)}...` : comment;

      return `Comment: ${shortened}`;
    }

    default:
      return "Request list activity occurred.";
  }
}

export const sendDataroomTaskNotificationTask = task({
  id: "send-dataroom-task-notification",
  retry: {
    maxAttempts: 3,
  },

  run: async (payload: DataroomTaskNotificationPayload) => {
    const taskRecord = await prisma.task.findFirst({
      where: {
        id: payload.taskId,
        dataroomId: payload.dataroomId,
        teamId: payload.teamId,
      },
      select: {
        id: true,
        title: true,
        createdByUserId: true,
        lastActivityNotifiedAt: true,
        dataroom: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!taskRecord) {
      logger.info("Request List task no longer exists", {
        taskId: payload.taskId,
      });
      return;
    }

    const activities = await prisma.taskActivity.findMany({
      where: {
        taskId: taskRecord.id,
        type: {
          in: NOTIFIABLE_ACTIVITY_TYPES,
        },
        ...(taskRecord.lastActivityNotifiedAt
          ? {
              createdAt: {
                gt: taskRecord.lastActivityNotifiedAt,
              },
            }
          : {}),
      },
      select: {
        id: true,
        type: true,
        comment: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
      },
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
    });

    if (activities.length === 0) {
      logger.info("No unsent Request List activity", {
        taskId: taskRecord.id,
      });
      return;
    }

    const recipients = await dispatchNotification({
      teamId: payload.teamId,
      notificationType: "DATAROOM_TASK",
      taskOwnerId: taskRecord.createdByUserId,
    });

    if (recipients.length === 0) {
      // Intentionally do not advance lastActivityNotifiedAt. The cursor marks
      // activity that was actually emailed, not merely inspected.
      logger.info("No recipients for Request List activity", {
        taskId: taskRecord.id,
      });
      return;
    }

    const primaryRecipient = recipients[0];
    const ccRecipients = recipients
      .slice(1)
      .map((recipient) => recipient.email);

    const sendResult = await sendDataroomTaskNotification({
      ownerEmail: primaryRecipient.email,
      teamMembers: ccRecipients.length > 0 ? ccRecipients : undefined,
      dataroomId: payload.dataroomId,
      dataroomName: taskRecord.dataroom.name,
      taskTitle: taskRecord.title,
      activityLines: activities.map(activityToLine),
    });

    if (!sendResult.success) {
      logger.error("Failed to send Request List activity notification", {
        taskId: taskRecord.id,
        error: sendResult.error,
      });

      // Throw so Trigger.dev retries. The notification cursor remains
      // untouched, therefore the retry sees the same activity batch.
      throw sendResult.error instanceof Error
        ? sendResult.error
        : new Error("Failed to send Request List activity notification");
    }

    const newestActivity = activities[activities.length - 1];

    // Never move the cursor backwards if another worker has already advanced
    // it. At-least-once delivery is preferable to silently skipping activity.
    await prisma.task.updateMany({
      where: {
        id: taskRecord.id,
        OR: [
          {
            lastActivityNotifiedAt: null,
          },
          {
            lastActivityNotifiedAt: {
              lt: newestActivity.createdAt,
            },
          },
        ],
      },
      data: {
        lastActivityNotifiedAt: newestActivity.createdAt,
      },
    });

    logger.info("Request List activity notification sent", {
      taskId: taskRecord.id,
      activityCount: activities.length,
      newestActivityId: newestActivity.id,
    });
  },
});

export async function scheduleDataroomTaskNotification({
  taskId,
  dataroomId,
  teamId,
}: DataroomTaskNotificationPayload): Promise<void> {
  const tags = [`team_${teamId}`, `dataroom_${dataroomId}`, `task_${taskId}`];

  // Trigger.dev's tag filter is OR-based, so post-filter to require all tags.
  const allRuns = await runs.list({
    taskIdentifier: ["send-dataroom-task-notification"],
    tag: tags,
    status: ["DELAYED", "QUEUED"],
    period: "10m",
  });

  const matchingRuns = allRuns.data.filter((run) =>
    tags.every((tag) => run.tags?.includes(tag)),
  );

  await Promise.all(matchingRuns.map((run) => runs.cancel(run.id)));

  await sendDataroomTaskNotificationTask.trigger(
    {
      taskId,
      dataroomId,
      teamId,
    },
    {
      idempotencyKey: `request-list-notification-${teamId}-${dataroomId}-${taskId}-${Date.now()}`,
      tags,
      delay: new Date(Date.now() + 5 * 60 * 1000),
    },
  );
}
