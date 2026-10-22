import prisma from "@/lib/prisma";

export const PREMIUM_TEAM_LIMIT = 5;

export type PremiumTeamEligibility = {
  isPremiumAdmin: boolean;
  canCreate: boolean;
};

/**
 * Data Rooms Premium admins may provision Premium teams until they
 * reach the five-team entitlement introduced for this plan.
 */
export async function getPremiumTeamEligibility(
  userId: string,
): Promise<PremiumTeamEligibility> {
  const premiumTeamCount = await prisma.team.count({
    where: {
      plan: {
        contains: "datarooms-premium",
      },
      users: {
        some: {
          userId,
          role: "ADMIN",
        },
      },
    },
  });

  return {
    isPremiumAdmin: premiumTeamCount > 0,
    canCreate: premiumTeamCount > 0 && premiumTeamCount < PREMIUM_TEAM_LIMIT,
  };
}
