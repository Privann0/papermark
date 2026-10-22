import { type Brand } from "@prisma/client";
import { del } from "@vercel/blob";

import { TeamError } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  clearCachedBrandLogo,
  writeCachedBrandLogo,
} from "@/lib/redis/brand-logo-cache";

const ASSET_FIELDS = [
  "logo",
  "banner",
  "linkPreviewImage",
  "linkPreviewFavicon",
] as const;

function isDeletableAssetUrl(url: string | null | undefined): url is string {
  if (!url || url === "no-banner") return false;
  return !url.startsWith("/") && !url.startsWith("data:");
}

/**
 * Best-effort removal of a deleted brand's uploaded assets. Skips URLs still
 * used by another Brand or DataroomBrand (duplicated rooms share uploads).
 */
async function deleteUnreferencedAssets(brand: Brand): Promise<void> {
  const urls = Array.from(
    new Set(ASSET_FIELDS.map((f) => brand[f]).filter(isDeletableAssetUrl)),
  );

  await Promise.all(
    urls.map(async (url) => {
      const where = {
        OR: ASSET_FIELDS.map((field) => ({ [field]: url })),
      };
      const [brandRefs, dataroomBrandRefs] = await Promise.all([
        prisma.brand.count({ where }),
        prisma.dataroomBrand.count({ where }),
      ]);
      if (brandRefs + dataroomBrandRefs > 0) return;
      await del(url).catch(() => {});
    }),
  );
}

/**
 * Delete one of the team's brands. When it was the effective default, the
 * oldest remaining brand becomes the persisted default and the logo cache
 * follows it (or is cleared when no brand is left). Links and datarooms that
 * pointed at the brand are set to NULL by the FK and fall back to the default.
 */
export async function deleteTeamBrand({
  teamId,
  brand,
}: {
  teamId: string;
  brand: Brand;
}): Promise<void> {
  const { shouldSyncDefaultCache, successor } = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;

      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { defaultBrandId: true },
      });
      const oldest = await tx.brand.findFirst({
        where: { teamId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      // A pointer at a missing or foreign brand doesn't count as the default.
      const pointerValid =
        !!team?.defaultBrandId &&
        (await tx.brand.count({
          where: { id: team.defaultBrandId, teamId },
        })) > 0;
      const effectiveDefaultId = pointerValid
        ? team!.defaultBrandId
        : (oldest?.id ?? null);

      const { count } = await tx.brand.deleteMany({
        where: { id: brand.id, teamId },
      });
      if (count === 0) throw new TeamError("Brand not found");

      if (effectiveDefaultId !== brand.id && pointerValid) {
        return { shouldSyncDefaultCache: false, successor: null };
      }

      const next = await tx.brand.findFirst({
        where: { teamId },
        orderBy: { createdAt: "asc" },
      });
      await tx.team.update({
        where: { id: teamId },
        data: { defaultBrandId: next?.id ?? null },
      });
      return {
        // Sync whenever the effective default changed OR an invalid/foreign
        // persisted pointer was repaired to the team's local fallback.
        shouldSyncDefaultCache:
          !pointerValid || effectiveDefaultId === brand.id,
        successor: next,
      };
    },
  );

  // Cache writes happen after commit so a rolled-back delete is never cached.
  if (shouldSyncDefaultCache) {
    if (successor) {
      await writeCachedBrandLogo(teamId, successor);
    } else {
      await clearCachedBrandLogo(teamId);
    }
  }

  await deleteUnreferencedAssets(brand);
}
