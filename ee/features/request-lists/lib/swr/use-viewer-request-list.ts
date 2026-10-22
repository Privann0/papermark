import useSWR from "swr";

import { fetcher } from "@/lib/utils";

export type ViewerRequestListTask = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  category: string | null;
  dueDate: string | null;
  orderIndex: number | null;
  uploadCount: number;
};

export type ViewerRequestListData = {
  enabled: boolean;
  teamId: string | null;
  list: {
    id: string;
    name: string;
  } | null;
  tasks: ViewerRequestListTask[];
};

const EMPTY_REQUEST_LIST: ViewerRequestListData = {
  enabled: false,
  teamId: null,
  list: null,
  tasks: [],
};

export function useViewerRequestList({
  linkId,
  dataroomId,
  viewerId,
  isPreview,
}: {
  linkId?: string;
  dataroomId?: string;
  viewerId?: string;
  isPreview?: boolean;
}) {
  const shouldFetch =
    !isPreview &&
    typeof linkId === "string" &&
    linkId.length > 0 &&
    typeof dataroomId === "string" &&
    dataroomId.length > 0 &&
    typeof viewerId === "string" &&
    viewerId.length > 0;

  const key = shouldFetch
    ? `/api/links/${encodeURIComponent(linkId!)}/request-list?dataroomId=${encodeURIComponent(
        dataroomId!,
      )}&viewerId=${encodeURIComponent(viewerId!)}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ViewerRequestListData>(
    key,
    fetcher,
  );

  const resolved = data ?? EMPTY_REQUEST_LIST;

  return {
    ...resolved,
    isLoading: shouldFetch ? isLoading : false,
    error,
    mutate,
  };
}
