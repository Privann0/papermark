import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import {
  BRANDING_PREVIEW_MESSAGE,
  BRANDING_PREVIEW_READY,
  type BrandingPreviewParams,
} from "./branding-preview-message";

function normalizeQuery(
  query: Record<string, string | string[] | undefined>,
): BrandingPreviewParams {
  const params: BrandingPreviewParams = {};

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      params[key] = value;
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      params[key] = value[0];
    }
  }

  return params;
}

/**
 * Preview state is seeded from the iframe URL once, then updated live over
 * postMessage so branding changes do not reload/flash the iframe.
 */
export function useBrandingPreviewParams(): BrandingPreviewParams {
  const router = useRouter();
  const [params, setParams] = useState<BrandingPreviewParams>({});

  const bootstrappedRef = useRef(false);
  const messageReceivedRef = useRef(false);

  useEffect(() => {
    if (
      !router.isReady ||
      bootstrappedRef.current ||
      messageReceivedRef.current
    ) {
      return;
    }

    bootstrappedRef.current = true;
    setParams(
      normalizeQuery(
        router.query as Record<string, string | string[] | undefined>,
      ),
    );
  }, [router.isReady, router.query]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      if (event.data?.type !== BRANDING_PREVIEW_MESSAGE) return;

      const payload = event.data?.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return;
      }

      messageReceivedRef.current = true;

      const next: BrandingPreviewParams = {};
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === "string") {
          next[key] = value;
        }
      }

      setParams(next);
    };

    window.addEventListener("message", onMessage);

    window.parent?.postMessage(
      { type: BRANDING_PREVIEW_READY },
      window.location.origin,
    );

    return () => window.removeEventListener("message", onMessage);
  }, []);

  return params;
}
