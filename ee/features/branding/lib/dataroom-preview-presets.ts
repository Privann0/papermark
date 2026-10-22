type PreviewFolder = {
  id: string;
  name: string;
  parentId: string | null;
  dataroomId: string;
  orderIndex: number | null;
  hierarchicalIndex: string | null;
  path: string;
  createdAt: Date;
  updatedAt: Date;
  icon: string | null;
  color: string | null;
};

type PreviewDocumentVersion = {
  id: string;
  type: string;
  versionNumber: number;
  hasPages: boolean;
  isVertical: boolean;
  updatedAt: Date;
};

type PreviewDocument = {
  id: string;
  name: string;
  dataroomDocumentId: string;
  folderName: string | null;
  downloadOnly: boolean;
  canDownload: boolean;
  hierarchicalIndex: string | null;
  versions: PreviewDocumentVersion[];
};

type DataroomPreviewDataset = {
  id: string;
  name: string;
  folders: PreviewFolder[];
  documents: PreviewDocument[];
};

export function getDataroomPreviewDataset(): DataroomPreviewDataset {
  const now = new Date();

  return {
    id: "preview",
    name: "Example Virtual Data Room",
    folders: [
      {
        id: "1",
        name: "Marketing",
        parentId: null,
        dataroomId: "1",
        orderIndex: 0,
        hierarchicalIndex: null,
        path: "/",
        createdAt: now,
        updatedAt: now,
        icon: null,
        color: null,
      },
      {
        id: "2",
        name: "Sales",
        parentId: null,
        dataroomId: "1",
        orderIndex: 1,
        hierarchicalIndex: null,
        path: "/",
        createdAt: now,
        updatedAt: now,
        icon: null,
        color: null,
      },
    ],
    documents: [
      {
        id: "1",
        name: "Q4 Report.pdf",
        dataroomDocumentId: "1",
        folderName: null,
        downloadOnly: false,
        canDownload: false,
        hierarchicalIndex: null,
        versions: [
          {
            id: "1",
            type: "pdf",
            versionNumber: 1,
            hasPages: true,
            isVertical: true,
            updatedAt: now,
          },
        ],
      },
    ],
  };
}
