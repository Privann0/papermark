import { z } from "zod";

import { validateRedirectUrl } from "@/lib/api/domains/validate-redirect-url";
import {
  teamPlanAllowsCustomWelcomeAndCta,
  teamPlanAllowsLayoutCustomization,
} from "@/lib/billing/team-plan-custom-messaging";
import { getFeatureFlags } from "@/lib/featureFlags";

import {
  DataroomCardLayoutSchema,
  DataroomViewerHeaderStyleSchema,
  DataroomViewerLayoutPresetSchema,
} from "./dataroom-viewer-layout";

// `z.object` strips unknown keys, so `id` and `teamId` in a request body never
// reach the returned data (POST /brands spreads it into `brand.create`).
const brandWriteSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  logo: z.string().nullable().optional(),
  hideLogo: z.boolean().optional(),
  banner: z.string().nullable().optional(),
  brandColor: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  accentButtonColor: z.string().nullable().optional(),
  applyAccentColorToDataroomView: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
  customLinkPreviewEnabled: z.boolean().optional(),
  linkPreviewTitle: z.string().nullable().optional(),
  linkPreviewDescription: z.string().nullable().optional(),
  linkPreviewImage: z.string().nullable().optional(),
  linkPreviewFavicon: z.string().nullable().optional(),
  ctaLabel: z.string().nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  privacyPolicyUrl: z.string().nullable().optional(),
  cardLayout: DataroomCardLayoutSchema.optional(),
  showFolderTree: z.boolean().optional(),
  viewerLayoutPreset: DataroomViewerLayoutPresetSchema.optional(),
  viewerHeaderStyle: DataroomViewerHeaderStyleSchema.optional(),
  hideFolderIconsInMain: z.boolean().optional(),
});

type BrandWriteBody = z.infer<typeof brandWriteSchema>;

// Fields left `undefined` are skipped by Prisma: untouched on update, column
// default on create.
export type BrandWriteData = Omit<BrandWriteBody, "name"> & { name?: string };

export type PrepareBrandWriteResult =
  | { ok: true; data: BrandWriteData }
  | {
      ok: false;
      status: number;
      message: string;
      errors?: Record<string, string[] | undefined>;
    };

/**
 * Validate and gate a Brand create/update body the same way the legacy
 * `/branding` route does: Zod parse, plan gating for messaging and layout
 * fields, CTA and privacy-policy URLs through the redirect validator.
 * With `nameRequired` a missing name is a 400; otherwise an absent name is
 * left untouched (`data.name` is then `undefined` at runtime, which Prisma
 * skips on update).
 */
export async function prepareBrandWrite({
  body,
  teamId,
  plan,
  nameRequired = false,
}: {
  body: unknown;
  teamId: string;
  plan: string;
  nameRequired?: boolean;
}): Promise<PrepareBrandWriteResult> {
  const parsed = brandWriteSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: "Invalid request body",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;

  if (nameRequired && !input.name) {
    return {
      ok: false,
      status: 400,
      message: "Invalid request body",
      errors: { name: ["Brand name is required"] },
    };
  }

  const messagingAllowed = teamPlanAllowsCustomWelcomeAndCta(plan);
  const layoutAllowed = teamPlanAllowsLayoutCustomization(plan);

  let ctaUrl: string | null | undefined = input.ctaUrl;
  if (messagingAllowed && typeof input.ctaUrl === "string") {
    const validation = await validateRedirectUrl(input.ctaUrl, teamId);
    if (!validation.valid) {
      return { ok: false, status: 400, message: validation.message };
    }
    ctaUrl = validation.url;
  }

  let privacyPolicyUrl: string | null | undefined = undefined;
  const featureFlags = await getFeatureFlags({ teamId });
  if (featureFlags.customPrivacyUrl && input.privacyPolicyUrl !== undefined) {
    const trimmed = input.privacyPolicyUrl?.trim() ?? "";
    if (!trimmed) {
      privacyPolicyUrl = null;
    } else {
      const validation = await validateRedirectUrl(trimmed, teamId);
      if (!validation.valid) {
        return {
          ok: false,
          status: 400,
          message: validation.message.replace(
            "Redirect URL",
            "Privacy policy URL",
          ),
        };
      }
      privacyPolicyUrl = validation.url || null;
    }
  }

  const data: BrandWriteData = {
    name: input.name,
    logo: input.logo,
    hideLogo: input.hideLogo,
    banner: input.banner,
    brandColor: input.brandColor,
    accentColor: input.accentColor,
    accentButtonColor: input.accentButtonColor,
    applyAccentColorToDataroomView: input.applyAccentColorToDataroomView,
    privacyPolicyUrl,
    ...(messagingAllowed && {
      welcomeMessage: input.welcomeMessage,
      customLinkPreviewEnabled: input.customLinkPreviewEnabled,
      linkPreviewTitle: input.linkPreviewTitle,
      linkPreviewDescription: input.linkPreviewDescription,
      linkPreviewImage: input.linkPreviewImage,
      linkPreviewFavicon: input.linkPreviewFavicon,
      ctaLabel: input.ctaLabel,
      ctaUrl,
    }),
    ...(layoutAllowed && {
      cardLayout: input.cardLayout,
      showFolderTree: input.showFolderTree,
      viewerLayoutPreset: input.viewerLayoutPreset,
      viewerHeaderStyle: input.viewerHeaderStyle,
      hideFolderIconsInMain: input.hideFolderIconsInMain,
    }),
  };

  return { ok: true, data };
}
