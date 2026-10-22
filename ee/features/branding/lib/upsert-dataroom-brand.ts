import { type DataroomBrand, Prisma } from "@prisma/client";

import { TeamError } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";

export type DataroomBrandWriteData = Omit<
  Prisma.DataroomBrandUncheckedCreateInput,
  "id" | "dataroomId"
>;

/**
 * Save the dataroom's own brand and switch the room onto it: the
 * DataroomBrand row is created or updated (keyed by `dataroomId`), and
 * `Dataroom.brandId` is cleared so the room stops inheriting a team brand.
 * Runs in one transaction scoped to `{ id: dataroomId, teamId }`.
 */
export async function upsertDataroomBrandAndClearInherited({
  dataroomId,
  teamId,
  data,
}: {
  dataroomId: string;
  teamId: string;
  data: DataroomBrandWriteData;
}): Promise<DataroomBrand> {
  // Never let the payload re-target the row.
  const {
    id: _id,
    dataroomId: _dataroomId,
    ...fields
  } = data as Prisma.DataroomBrandUncheckedCreateInput;

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.dataroom.updateMany({
      where: { id: dataroomId, teamId },
      data: { brandId: null },
    });
    if (count === 0) throw new TeamError("Dataroom not found");

    return tx.dataroomBrand.upsert({
      where: { dataroomId },
      create: { ...fields, dataroomId },
      update: fields,
    });
  });
}
