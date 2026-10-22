import {
  DefaultPermissionStrategy,
  ItemType,
  RootItemAccess,
} from "@prisma/client";

import { revalidateLinksForDataroom } from "@/lib/api/links/revalidate";
import prisma from "@/lib/prisma";

import { resolveRootItemAccessFlags } from "./root-item-access";

type GroupTarget = "VIEWER_GROUP" | "PERMISSION_GROUP";

type DataroomDocumentRef = {
  id: string;
  folderId: string | null;
};

type Schedule = (promise: Promise<unknown>) => void;

export async function applyDataroomDocumentPermissionDefaults({
  dataroomId,
  dataroomDocuments,
  groupStrategy,
  groupRootItemAccess,
  linkStrategy,
  linkRootItemAccess,
}: {
  dataroomId: string;
  dataroomDocuments: DataroomDocumentRef[];
  groupStrategy: DefaultPermissionStrategy;
  groupRootItemAccess: RootItemAccess;
  linkStrategy: DefaultPermissionStrategy;
  linkRootItemAccess: RootItemAccess;
}) {
  await Promise.all([
    applyPermissionStrategy({
      dataroomId,
      dataroomDocuments,
      strategy: groupStrategy,
      rootItemAccess: groupRootItemAccess,
      target: "VIEWER_GROUP",
    }),
    applyPermissionStrategy({
      dataroomId,
      dataroomDocuments,
      strategy: linkStrategy,
      rootItemAccess: linkRootItemAccess,
      target: "PERMISSION_GROUP",
    }),
  ]);
}

export async function onDataroomDocumentsAttached({
  dataroomId,
  dataroomDocuments,
  schedule,
}: {
  dataroomId: string;
  dataroomDocuments: DataroomDocumentRef[];
  schedule?: Schedule;
}) {
  if (dataroomDocuments.length === 0) return;

  const dataroom = await prisma.dataroom.findUnique({
    where: { id: dataroomId },
    select: {
      defaultPermissionStrategy: true,
      defaultGroupPermissionStrategy: true,
      defaultRootItemAccess: true,
      defaultGroupRootItemAccess: true,
    },
  });

  if (!dataroom) {
    throw new Error(`Dataroom not found: ${dataroomId}`);
  }

  await applyDataroomDocumentPermissionDefaults({
    dataroomId,
    dataroomDocuments,
    groupStrategy: dataroom.defaultGroupPermissionStrategy,
    groupRootItemAccess: dataroom.defaultGroupRootItemAccess,
    linkStrategy: dataroom.defaultPermissionStrategy,
    linkRootItemAccess: dataroom.defaultRootItemAccess,
  });

  const revalidation = revalidateLinksForDataroom(dataroomId);

  if (schedule) {
    schedule(revalidation);
  } else {
    await revalidation;
  }
}

async function applyPermissionStrategy({
  dataroomId,
  dataroomDocuments,
  strategy,
  rootItemAccess,
  target,
}: {
  dataroomId: string;
  dataroomDocuments: DataroomDocumentRef[];
  strategy: DefaultPermissionStrategy;
  rootItemAccess: RootItemAccess;
  target: GroupTarget;
}) {
  if (strategy !== DefaultPermissionStrategy.INHERIT_FROM_PARENT) return;

  const rootDocuments: DataroomDocumentRef[] = [];
  const documentsByFolderId = new Map<string, DataroomDocumentRef[]>();

  for (const document of dataroomDocuments) {
    if (document.folderId === null) {
      rootDocuments.push(document);
      continue;
    }

    const documents = documentsByFolderId.get(document.folderId) ?? [];
    documents.push(document);
    documentsByFolderId.set(document.folderId, documents);
  }

  await Promise.all([
    rootDocuments.length > 0
      ? applyRootLevelPermissions({
          dataroomId,
          dataroomDocuments: rootDocuments,
          rootItemAccess,
          target,
        })
      : Promise.resolve(),
    ...Array.from(documentsByFolderId, ([folderId, documents]) =>
      inheritFromContainingFolder({
        folderId,
        dataroomDocuments: documents,
        target,
      }),
    ),
  ]);
}

async function upsertViewerGroupDocumentRows(
  data: {
    groupId: string;
    itemId: string;
    itemType: ItemType;
    canView: boolean;
    canDownload: boolean;
  }[],
) {
  if (data.length === 0) return;

  const groupIds = Array.from(new Set(data.map((row) => row.groupId)));
  const itemIds = Array.from(new Set(data.map((row) => row.itemId)));

  await prisma.$transaction([
    prisma.viewerGroupAccessControls.deleteMany({
      where: {
        groupId: { in: groupIds },
        itemId: { in: itemIds },
        itemType: ItemType.DATAROOM_DOCUMENT,
      },
    }),
    prisma.viewerGroupAccessControls.createMany({ data }),
  ]);
}

async function upsertPermissionGroupDocumentRows(
  data: {
    groupId: string;
    itemId: string;
    itemType: ItemType;
    canView: boolean;
    canDownload: boolean;
    canDownloadOriginal: boolean;
  }[],
) {
  if (data.length === 0) return;

  const groupIds = Array.from(new Set(data.map((row) => row.groupId)));
  const itemIds = Array.from(new Set(data.map((row) => row.itemId)));

  await prisma.$transaction([
    prisma.permissionGroupAccessControls.deleteMany({
      where: {
        groupId: { in: groupIds },
        itemId: { in: itemIds },
        itemType: ItemType.DATAROOM_DOCUMENT,
      },
    }),
    prisma.permissionGroupAccessControls.createMany({ data }),
  ]);
}

async function applyRootLevelPermissions({
  dataroomId,
  dataroomDocuments,
  rootItemAccess,
  target,
}: {
  dataroomId: string;
  dataroomDocuments: DataroomDocumentRef[];
  rootItemAccess: RootItemAccess;
  target: GroupTarget;
}) {
  const flags = resolveRootItemAccessFlags(rootItemAccess);
  if (!flags) return;

  if (target === "VIEWER_GROUP") {
    const viewerGroups = await prisma.viewerGroup.findMany({
      where: { dataroomId },
      select: { id: true },
    });

    await upsertViewerGroupDocumentRows(
      viewerGroups.flatMap((group) =>
        dataroomDocuments.map((document) => ({
          groupId: group.id,
          itemId: document.id,
          itemType: ItemType.DATAROOM_DOCUMENT,
          canView: flags.canView,
          canDownload: flags.canDownload,
        })),
      ),
    );

    return;
  }

  const permissionGroups = await prisma.permissionGroup.findMany({
    where: { dataroomId },
    select: { id: true },
  });

  await upsertPermissionGroupDocumentRows(
    permissionGroups.flatMap((group) =>
      dataroomDocuments.map((document) => ({
        groupId: group.id,
        itemId: document.id,
        itemType: ItemType.DATAROOM_DOCUMENT,
        canView: flags.canView,
        canDownload: flags.canDownload,
        canDownloadOriginal: false,
      })),
    ),
  );
}

async function inheritFromContainingFolder({
  folderId,
  dataroomDocuments,
  target,
}: {
  folderId: string;
  dataroomDocuments: DataroomDocumentRef[];
  target: GroupTarget;
}) {
  if (target === "VIEWER_GROUP") {
    const folderPermissions = await prisma.viewerGroupAccessControls.findMany({
      where: {
        itemId: folderId,
        itemType: ItemType.DATAROOM_FOLDER,
      },
      select: {
        groupId: true,
        canView: true,
        canDownload: true,
      },
    });

    await upsertViewerGroupDocumentRows(
      folderPermissions.flatMap((permission) =>
        dataroomDocuments.map((document) => ({
          groupId: permission.groupId,
          itemId: document.id,
          itemType: ItemType.DATAROOM_DOCUMENT,
          canView: permission.canView,
          canDownload: permission.canDownload,
        })),
      ),
    );

    return;
  }

  const folderPermissions = await prisma.permissionGroupAccessControls.findMany(
    {
      where: {
        itemId: folderId,
        itemType: ItemType.DATAROOM_FOLDER,
      },
      select: {
        groupId: true,
        canView: true,
        canDownload: true,
        canDownloadOriginal: true,
      },
    },
  );

  await upsertPermissionGroupDocumentRows(
    folderPermissions.flatMap((permission) =>
      dataroomDocuments.map((document) => ({
        groupId: permission.groupId,
        itemId: document.id,
        itemType: ItemType.DATAROOM_DOCUMENT,
        canView: permission.canView,
        canDownload: permission.canDownload,
        canDownloadOriginal: permission.canDownloadOriginal,
      })),
    ),
  );
}
