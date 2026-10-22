import { useEffect, useMemo, useRef, useState } from "react";

import {
  BRANDING_PREVIEW_MESSAGE,
  BRANDING_PREVIEW_READY,
  type BrandingPreviewParams,
} from "@/ee/features/branding/lib/branding-preview-message";

type BrandingPreviewFrameProps = {
  name: string;
  basePath: string;
  params: BrandingPreviewParams;
};

export function BrandingPreviewFrame({
  name,
  basePath,
  params,
}: BrandingPreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Bake the initial state into the URL once. Subsequent edits are streamed
  // through postMessage so the iframe stays mounted and does not flash.
  const [initialSrc] = useState(() => {
    const search = new URLSearchParams(params);
    return `${basePath}?${search.toString()}`;
  });

  useEffect(() => {
    const post = () => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: BRANDING_PREVIEW_MESSAGE,
          payload: paramsRef.current,
        },
        window.location.origin,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== BRANDING_PREVIEW_READY) return;

      readyRef.current = true;
      post();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;

    iframeRef.current?.contentWindow?.postMessage(
      {
        type: BRANDING_PREVIEW_MESSAGE,
        payload: params,
      },
      window.location.origin,
    );
  }, [params]);

  const iframeId = useMemo(() => `${name}-preview`, [name]);

  return (
    <iframe
      ref={iframeRef}
      name={iframeId}
      id={iframeId}
      src={initialSrc}
      sandbox="allow-scripts allow-same-origin"
      className="absolute left-0 top-0 h-full w-full origin-top-left scale-50 overflow-hidden rounded-b-lg border-0 bg-white"
      style={{
        width: "200%",
        height: "200%",
        pointerEvents: "none",
      }}
    />
  );
}
