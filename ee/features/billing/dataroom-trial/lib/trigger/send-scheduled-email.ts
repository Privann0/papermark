import { logger, task } from "@trigger.dev/sdk";

import { sendDataroomTrial24hReminderEmail } from "@/lib/emails/send-dataroom-trial-24h";
import { sendDataroomTrialEndEmail } from "@/lib/emails/send-dataroom-trial-end";
import prisma from "@/lib/prisma";

type TrialEmailPayload = {
  to: string;
  name: string;
  teamId: string;
};

async function isTrialStillActive(teamId: string): Promise<boolean> {
  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
    },
    select: {
      plan: true,
    },
  });

  return team?.plan.includes("drtrial") ?? false;
}

export const sendDataroomTrial24hReminderEmailTask = task({
  id: "send-dataroom-trial-24h-reminder-email",
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: TrialEmailPayload) => {
    if (!(await isTrialStillActive(payload.teamId))) {
      logger.info("Skipping Data Room trial reminder", {
        teamId: payload.teamId,
        reason: "trial-not-active",
      });
      return;
    }

    await sendDataroomTrial24hReminderEmail({
      email: payload.to,
      name: payload.name,
    });
  },
});

export const sendDataroomTrialExpiredEmailTask = task({
  id: "send-dataroom-trial-expired-email",
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: TrialEmailPayload) => {
    if (!(await isTrialStillActive(payload.teamId))) {
      logger.info("Skipping Data Room trial expiration email", {
        teamId: payload.teamId,
        reason: "trial-not-active",
      });
      return;
    }

    await sendDataroomTrialEndEmail({
      email: payload.to,
      name: payload.name,
    });
  },
});
