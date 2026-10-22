import { sendEmail } from "@/lib/resend";

import DataroomTaskNotification from "@/components/emails/dataroom-task-notification";

export async function sendDataroomTaskNotification({
  ownerEmail,
  teamMembers,
  dataroomId,
  dataroomName,
  taskTitle,
  activityLines,
}: {
  ownerEmail: string;
  teamMembers?: string[];
  dataroomId: string;
  dataroomName: string;
  taskTitle: string;
  activityLines: string[];
}) {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    null;

  const dataroomUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/datarooms/${dataroomId}`
    : null;

  const emailTemplate = DataroomTaskNotification({
    dataroomName,
    taskTitle,
    activityLines,
    dataroomUrl,
  });

  try {
    const data = await sendEmail({
      to: ownerEmail,
      cc: teamMembers,
      subject: `Request list activity: ${taskTitle}`,
      react: emailTemplate,
      test: process.env.NODE_ENV === "development",
      system: true,
    });

    return {
      success: true as const,
      data,
    };
  } catch (error) {
    return {
      success: false as const,
      error,
    };
  }
}
