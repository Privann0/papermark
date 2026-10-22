import { type Brand, Prisma } from "@prisma/client";

import { TeamError } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// Field sets read from the team Brand on public link surfaces.

export const teamBrandViewerSelect = {
  logo: true,
  hideLogo: true,
  banner: true,
  brandColor: true,
  accentColor: true,
  accentButtonColor: true,
  applyAccentColorToDataroomView: true,
  welcomeMessage: true,
  ctaLabel: true,
  ctaUrl: true,
  cardLayout: true,
  showFolderTree: true,
  viewerLayoutPreset: true,
  viewerHeaderStyle: true,
  hideFolderIconsInMain: true,
  defaultLanguage: true,
  privacyPolicyUrl: true,
} as const satisfies Prisma.BrandSelect;

export const teamBrandWorkflowSelect = {
  logo: true,
  hideLogo: true,
  brandColor: true,
  accentColor: true,
  defaultLanguage: true,
  privacyPolicyUrl: true,
} as const satisfies Prisma.BrandSelect;

export const teamBrandOgSelect = {
  customLinkPreviewEnabled: true,
  linkPreviewTitle: true,
  linkPreviewDescription: true,
  linkPreviewImage: true,
  linkPreviewFavicon: true,
} as const satisfies Prisma.BrandSelect;

// Oldest brand first, matching upstream behavior.
const oldestFirst: Prisma.BrandOrderByWithRelationInput[] = [
  { createdAt: "asc" },
];

/**
 * Id of the team's effective default brand: `Team.defaultBrandId` when it
 * points at a brand of this team, otherwise the oldest brand, otherwise null.
 * The pointer is an FK without team scope, so it is re-checked against
 * `teamId` and a foreign pointer is ignored.
 */
async function findDefaultBrandIdWith(
  db: Db,
  teamId: string,
): Promise<string | null> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { defaultBrandId: true },
  });

  if (team?.defaultBrandId) {
    const pointed = await db.brand.findFirst({
      where: { id: team.defaultBrandId, teamId },
      select: { id: true },
    });
    if (pointed) return pointed.id;
  }

  const oldest = await db.brand.findFirst({
    where: { teamId },
    orderBy: oldestFirst,
    select: { id: true },
  });
  return oldest?.id ?? null;
}

export async function resolveDefaultBrandId(
  teamId: string,
): Promise<string | null> {
  return findDefaultBrandIdWith(prisma, teamId);
}

export async function findDefaultBrand(teamId: string): Promise<Brand | null> {
  const id = await findDefaultBrandIdWith(prisma, teamId);
  if (!id) return null;
  return prisma.brand.findFirst({ where: { id, teamId } });
}

/**
 * Brand that applies to a link, in precedence order: the link's own brand,
 * then the dataroom's base brand, then the team default. Every candidate is
 * scoped to `teamId`; a missing or foreign id falls through to the next one.
 */
export async function resolveBaseBrand<S extends Prisma.BrandSelect>({
  teamId,
  linkBrandId,
  dataroomBrandId,
  select,
}: {
  teamId: string;
  linkBrandId?: string | null;
  dataroomBrandId?: string | null;
  select: S;
}): Promise<Prisma.BrandGetPayload<{ select: S }> | null> {
  for (const id of [linkBrandId, dataroomBrandId]) {
    if (!id) continue;
    const brand = await prisma.brand.findFirst({
      where: { id, teamId },
      select,
    });
    if (brand) return brand as Prisma.BrandGetPayload<{ select: S }>;
  }

  const defaultId = await findDefaultBrandIdWith(prisma, teamId);
  if (!defaultId) return null;

  const brand = await prisma.brand.findFirst({
    where: { id: defaultId, teamId },
    select,
  });
  return brand as Prisma.BrandGetPayload<{ select: S }> | null;
}

/**
 * Validate a brand id from a request body before persisting it on a link or
 * dataroom. Empty values mean "inherit" and return null. An id that is not a
 * brand of this team throws (400 via errorhandler) rather than silently
 * turning the request into "inherit"; missing and foreign ids get the same
 * message so the response doesn't reveal which.
 */
export async function resolveOwnedBrandId(
  teamId: string,
  brandId: unknown,
): Promise<string | null> {
  if (brandId === undefined || brandId === null || brandId === "") return null;
  if (typeof brandId !== "string") throw new TeamError("Brand not found");

  const brand = await prisma.brand.findFirst({
    where: { id: brandId, teamId },
    select: { id: true },
  });
  if (!brand) throw new TeamError("Brand not found");
  return brand.id;
}

/**
 * Legacy single-brand write used by `/api/teams/[teamId]/branding`: update the
 * team's effective default brand, or create the first brand and point
 * `Team.defaultBrandId` at it. Repeated calls never create a second brand.
 * The team row is locked so concurrent first writes serialise. The caller
 * mirrors the returned row into the logo cache.
 */
export async function persistDefaultBrand({
  teamId,
  create,
  update,
}: {
  teamId: string;
  create: Prisma.BrandUncheckedCreateInput;
  update: Prisma.BrandUncheckedUpdateInput;
}): Promise<Brand> {
  // The top-level teamId is authoritative; never let the payload move a brand.
  const { teamId: _createTeamId, id: _createId, ...createData } = create;
  const { teamId: _updateTeamId, id: _updateId, ...updateData } = update;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;

    const defaultId = await findDefaultBrandIdWith(tx, teamId);

    if (defaultId) {
      const brand = await tx.brand.update({
        where: { id: defaultId },
        data: updateData,
      });
      // Heal a missing or stale pointer to the brand we just resolved.
      await tx.team.update({
        where: { id: teamId },
        data: { defaultBrandId: defaultId },
      });
      return brand;
    }

    const brand = await tx.brand.create({
      data: { ...createData, teamId },
    });
    await tx.team.update({
      where: { id: teamId },
      data: { defaultBrandId: brand.id },
    });
    return brand;
  });
}
