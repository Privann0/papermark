import { z } from "zod";
export const RestrictedTokenSubjectTypeSchema = z.enum(["user", "machine"]);
export type RestrictedTokenSubjectType = z.infer<typeof RestrictedTokenSubjectTypeSchema>;
export const parseRestrictedTokenSubjectType = (value: string): RestrictedTokenSubjectType => {
  const parsed = RestrictedTokenSubjectTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "user";
};
export const revokeUserBoundTeamTokens = async (_userId: string, _teamId: string) => {};
