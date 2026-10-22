import { NextRequest, NextResponse } from "next/server";

import { isViewerAssigned } from "@/ee/features/request-lists/lib/assignments";
import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";

import { processDocument } from "@/lib/api/documents/process-document";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { DocumentData } from "@/lib/documents/create-document";
import prisma from "@/lib/prisma";
import { sendDataroomChangeNotificationTask } from "@/lib/trigger/dataroom-change-notification";
import { scheduleDataroomTaskNotification } from "@/lib/trigger/dataroom-task-notification";
import { sendDataroomUploadNotificationTask } from "@/lib/trigger/dataroom-upload-notification";
import { supportsAdvancedExcelMode } from "@/lib/utils/get-content-type";
import { sanitizePlainText } from "@/lib/utils/sanitize-html";

/**
 * GET /api/links/[id]/upload?dataroomId=xxx
 * Returns the viewer's previously uploaded documents for this dataroom.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const dataroomId = request.nextUrl.searchParams.get("dataroomId");

    if (!linkId || !dataroomId) {
      return NextResponse.json(
        { message: "Missing required parameters" },
        { status: 400 },
      );
    }

    // Verify the dataroom session
    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (!dataroomSession || !dataroomSession.viewerId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { viewerId } = dataroomSession;

    // Fetch the viewer's uploads for this dataroom
    const uploads = await prisma.documentUpload.findMany({
      where: {
        viewerId,
        dataroomId,
        linkId,
      },
      select: {
        id: true,
        documentId: true,
        dataroomDocumentId: true,
        originalFilename: true,
        uploadedAt: true,
        document: {
          select: {
            id: true,
            name: true,
            type: true,
            versions: {
              where: { isPrimary: true },
              select: {
                id: true,
                hasPages: true,
              },
              take: 1,
            },
          },
        },
        dataroomDocument: {
          select: {
            folderId: true,
          },
        },
      },
      orderBy: { uploadedAt: "desc" },
    });

    const formattedUploads = uploads.map((upload) => {
      const fileType = upload.document?.type ?? "";
      const hasPages = upload.document?.versions?.[0]?.hasPages ?? false;
      const needsProcessing = ["pdf", "docs", "slides"].includes(fileType);
      const isComplete = !needsProcessing || hasPages;

      return {
        id: upload.id,
        documentId: upload.documentId,
        dataroomDocumentId: upload.dataroomDocumentId,
        documentVersionId: upload.document?.versions?.[0]?.id ?? null,
        name: upload.originalFilename ?? upload.document?.name ?? "Unknown",
        fileType,
        folderId: upload.dataroomDocument?.folderId ?? null,
        uploadedAt: upload.uploadedAt,
        status: isComplete ? "complete" : "processing",
      };
    });

    return NextResponse.json({ uploads: formattedUploads });
  } catch (error) {
    console.error("Error fetching viewer uploads:", error);
    return NextResponse.json(
      { message: "Error fetching uploads" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const body = await request.json();
    const { documentData, dataroomId, folderId, taskId } = body as {
      documentData: DocumentData;
      dataroomId: string;
      folderId?: string;
      taskId?: string;
    };

    if (!linkId || !documentData || !dataroomId) {
      return NextResponse.json(
        { message: "Missing required parameters" },
        { status: 400 },
      );
    }

    // 0. Verify the dataroom session
    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (!dataroomSession || !dataroomSession.viewerId) {
      return NextResponse.json(
        { message: "You need to be logged in to upload a document." },
        { status: 401 },
      );
    }

    // Check if the link exists and has visitor upload enabled
    const link = await prisma.link.findUnique({
      where: { id: linkId, dataroomId },
      select: {
        id: true,
        name: true,
        enableUpload: true,
        enableNotification: true,
        uploadFolderIds: true,
        dataroomId: true,
        teamId: true,
        team: {
          select: {
            plan: true,
            enableExcelAdvancedMode: true,
          },
        },
        dataroom: {
          select: {
            enableVisitorUploadChangeNotifications: true,
          },
        },
      },
    });

    if (!link || link.dataroomId !== dataroomId || !link.teamId) {
      return NextResponse.json(
        { message: "Uploads not allowed for this link" },
        { status: 403 },
      );
    }

    const { viewerId, viewId } = dataroomSession;

    // Check if the viewer exists
    const viewer = await prisma.viewer.findUnique({
      where: {
        id: viewerId,
        teamId: link.teamId,
        views: { some: { id: viewId } },
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

    let requestTask: { id: string; status: string } | null = null;
    let taskUploadFolderId: string | null = null;

    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          dataroomId,
          teamId: link.teamId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          uploadFolderId: true,
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

      const assigned =
        !!task &&
        task.type === "UPLOAD" &&
        isViewerAssigned(task.assignments, {
          viewerId,
          email: viewer.email ?? null,
          linkId,
          groupIds: new Set(viewer.groups.map((group) => group.groupId)),
        });

      if (!task || !assigned) {
        return NextResponse.json(
          { message: "Upload not allowed for this request" },
          { status: 403 },
        );
      }

      if (task.uploadFolderId) {
        const taskUploadFolder = await prisma.dataroomFolder.findFirst({
          where: {
            id: task.uploadFolderId,
            dataroomId,
          },
          select: {
            id: true,
          },
        });

        if (!taskUploadFolder) {
          return NextResponse.json(
            { message: "Invalid request upload destination" },
            { status: 403 },
          );
        }

        taskUploadFolderId = taskUploadFolder.id;
      }

      requestTask = {
        id: task.id,
        status: task.status,
      };
    }

    // Normal visitor uploads still require the link-level upload permission.
    // An assigned Request List UPLOAD task is the only exception.
    if (!link.enableUpload && !requestTask) {
      return NextResponse.json(
        { message: "Uploads not allowed for this link" },
        { status: 403 },
      );
    }

    if (typeof documentData.name !== "string") {
      return NextResponse.json(
        { message: "Document name is required" },
        { status: 400 },
      );
    }

    const sanitizedDocumentName = sanitizePlainText(documentData.name);
    if (!sanitizedDocumentName) {
      return NextResponse.json(
        { message: "Document name is required" },
        { status: 400 },
      );
    }

    if (sanitizedDocumentName.length > 255) {
      return NextResponse.json(
        { message: "Document name too long" },
        { status: 400 },
      );
    }

    const updatedDocumentData = {
      ...documentData,
      name: sanitizedDocumentName,
      enableExcelAdvancedMode:
        documentData.supportedFileType === "sheet" &&
        link.team?.enableExcelAdvancedMode &&
        supportsAdvancedExcelMode(documentData.contentType),
    };

    // 1. Create the document
    const document = await processDocument({
      documentData: updatedDocumentData,
      teamId: link.teamId,
      teamPlan: link.team?.plan ?? "free",
      isExternalUpload: true,
    });

    // 2. Resolve the target dataroom folder.
    //
    // Semantics:
    //   - Admin selected 0 folders  → visitor can upload anywhere (use folderId
    //     from the request, validated against the dataroom).
    //   - Admin selected 1+ folders → the visitor-supplied folderId must be
    //     inside that allow-list. If it isn't (e.g. the visitor is currently
    //     browsing another folder), fall back to the first allowed folder so
    //     uploads never silently escape the allow-list.
    const allowedUploadFolderIds = Array.isArray(link.uploadFolderIds)
      ? link.uploadFolderIds.filter(
          (id): id is string => typeof id === "string" && !!id,
        )
      : [];

    let dataroomFolderId: string | null = null;

    if (taskUploadFolderId) {
      dataroomFolderId = taskUploadFolderId;
    } else if (allowedUploadFolderIds.length === 0) {
      // No restriction: validate the visitor-chosen folder belongs to this
      // dataroom before using it.
      if (folderId) {
        const dataroomFolder = await prisma.dataroomFolder.findUnique({
          where: { id: folderId, dataroomId },
          select: { id: true },
        });
        dataroomFolderId = dataroomFolder?.id ?? null;
      }
    } else {
      // Restricted: look up all allowed folders in one query and prefer the
      // one the visitor is currently in if it's on the list.
      const allowedFolders = await prisma.dataroomFolder.findMany({
        where: {
          id: { in: allowedUploadFolderIds },
          dataroomId,
        },
        select: { id: true },
      });
      const allowedSet = new Set(allowedFolders.map((f) => f.id));

      if (folderId && allowedSet.has(folderId)) {
        dataroomFolderId = folderId;
      } else {
        // Preserve admin-selected ordering so the first allowed folder wins
        // when the visitor isn't currently inside one of the allowed folders.
        dataroomFolderId =
          allowedUploadFolderIds.find((id) => allowedSet.has(id)) ?? null;
      }
    }

    const newDataroomDocument = await prisma.dataroomDocument.create({
      data: {
        dataroomId: dataroomId,
        documentId: document.id,
        folderId: dataroomFolderId,
      },
    });

    // 3. Create the DocumentUpload record to track the upload details
    await prisma.documentUpload.create({
      data: {
        documentId: document.id,
        viewerId: viewerId,
        viewId: viewId,
        linkId: linkId,
        originalFilename: document.name,
        fileSize: documentData.fileSize ?? 0,
        numPages: document.numPages,
        mimeType: document.contentType,
        dataroomId: dataroomId,
        dataroomDocumentId: newDataroomDocument.id,
        teamId: link.teamId,
        taskId: requestTask?.id ?? null,
      },
    });

    if (requestTask) {
      await prisma.$transaction(async (tx) => {
        // Always record the upload itself.
        await tx.taskActivity.create({
          data: {
            taskId: requestTask.id,
            type: "UPLOADED",
            viewerId,
            viewId,
          },
        });

        // Uploading fulfills the viewer side of the request. Use a conditional
        // update so a concurrent admin COMPLETED transition is never
        // overwritten by a stale requestTask snapshot.
        if (
          requestTask.status !== "SUBMITTED" &&
          requestTask.status !== "COMPLETED"
        ) {
          const update = await tx.task.updateMany({
            where: {
              id: requestTask.id,
              status: requestTask.status,
            },
            data: {
              status: "SUBMITTED",
            },
          });

          if (update.count === 1) {
            await tx.taskActivity.create({
              data: {
                taskId: requestTask.id,
                type: "STATUS_CHANGED",
                fromStatus: requestTask.status,
                toStatus: "SUBMITTED",
                viewerId,
                viewId,
              },
            });
          }
        }
      });

      waitUntil(
        scheduleDataroomTaskNotification({
          taskId: requestTask.id,
          dataroomId,
          teamId: link.teamId,
        }).catch((error) => {
          console.error(
            "Failed to schedule Request List activity notification:",
            error,
          );
        }),
      );
    }

    // 4. Send upload notification to team if enabled
    if (link.enableNotification) {
      try {
        // Cancel any existing pending notification runs for this viewer+dataroom+link
        // Note: runs.list tag filter uses OR logic, so we must post-filter
        // to ensure we only cancel runs matching ALL three tags
        const requiredTags = [
          `dataroom_${dataroomId}`,
          `link_${linkId}`,
          `viewer_${viewerId}`,
        ];
        const allRuns = await runs.list({
          taskIdentifier: ["send-dataroom-upload-notification"],
          tag: requiredTags,
          status: ["DELAYED", "QUEUED"],
          period: "10m",
        });

        const matchingRuns = allRuns.data.filter((run) =>
          requiredTags.every((tag) => run.tags?.includes(tag)),
        );

        await Promise.all(matchingRuns.map((run) => runs.cancel(run.id)));

        // Trigger a new notification with 5-minute delay to batch uploads
        waitUntil(
          sendDataroomUploadNotificationTask.trigger(
            {
              dataroomId,
              linkId,
              viewerId,
              teamId: link.teamId,
            },
            {
              idempotencyKey: `upload-notification-${link.teamId}-${dataroomId}-${linkId}-${viewerId}-${newDataroomDocument.id}`,
              tags: [
                `team_${link.teamId}`,
                `dataroom_${dataroomId}`,
                `link_${linkId}`,
                `viewer_${viewerId}`,
              ],
              delay: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
            },
          ),
        );
      } catch (error) {
        console.error("Error triggering upload notification:", error);
      }
    }

    // 5. Notify other dataroom visitors about the new upload (each visitor gets their own email)
    //    Uses cancel-and-retrigger as a debounce: cancelled runs' document IDs
    //    are accumulated into the new run so no uploads are lost.
    if (link.dataroom?.enableVisitorUploadChangeNotifications) {
      try {
        const existingChangeRuns = await runs.list({
          taskIdentifier: ["send-dataroom-change-notification"],
          tag: [`dataroom_${dataroomId}`, `visitor_upload_${viewerId}`],
          status: ["DELAYED", "QUEUED"],
          period: "15m",
        });

        const matchingChangeRuns = existingChangeRuns.data.filter(
          (run) =>
            run.tags?.includes(`dataroom_${dataroomId}`) &&
            run.tags?.includes(`visitor_upload_${viewerId}`),
        );

        let accumulatedDocIds: string[] = [newDataroomDocument.id];
        for (const run of matchingChangeRuns) {
          const fullRun = await runs.retrieve(run.id);
          const existingIds = (
            fullRun.payload as { dataroomDocumentIds?: string[] } | undefined
          )?.dataroomDocumentIds;
          if (Array.isArray(existingIds)) {
            accumulatedDocIds.push(...existingIds);
          }
        }
        accumulatedDocIds = [...new Set(accumulatedDocIds)];

        await Promise.all(matchingChangeRuns.map((run) => runs.cancel(run.id)));

        waitUntil(
          sendDataroomChangeNotificationTask.trigger(
            {
              dataroomId,
              dataroomDocumentIds: accumulatedDocIds,
              senderUserId: null,
              teamId: link.teamId,
              excludeViewerId: viewerId,
            },
            {
              idempotencyKey: `visitor-change-notification-${link.teamId}-${dataroomId}-${viewerId}-${Date.now()}`,
              tags: [
                `team_${link.teamId}`,
                `dataroom_${dataroomId}`,
                `visitor_upload_${viewerId}`,
              ],
              delay: new Date(Date.now() + 10 * 60 * 1000),
            },
          ),
        );
      } catch (error) {
        console.error(
          "Error triggering visitor upload change notification:",
          error,
        );
      }
    }

    // Return document data for optimistic UI rendering
    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        name: document.name,
        dataroomDocumentId: newDataroomDocument.id,
        documentVersionId: document.versions[0]?.id,
        folderId: dataroomFolderId,
        fileType: document.type,
        hasPages: (document.numPages ?? 0) > 0,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    return NextResponse.json(
      { message: "Error uploading document" },
      { status: 500 },
    );
  }
}
