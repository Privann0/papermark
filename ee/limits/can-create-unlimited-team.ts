import prisma from "@/lib/prisma";

/**
 * An admin of an existing Data Rooms Unlimited team may provision
 * additional teams on the same plan.
 */
export async function canCreateUnlimitedTeam(userId: string): Promise<boolean> {
  const team = await prisma.team.findFirst({
    where: {
      plan: {
        contains: "datarooms-unlimited",
      },
      users: {
        some: {
          userId,
          role: "ADMIN",
        },
      },
    },
    select: {
      id: true,
    },
  });

  return team !== null;
}
