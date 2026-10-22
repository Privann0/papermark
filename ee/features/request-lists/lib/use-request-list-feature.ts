import { teamPlanIsDataroomPlusTier } from "@/lib/billing/team-plan-custom-messaging";
import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";

/**
 * Client-side equivalent of resolveRequestListEnabled().
 *
 * Request List is available on Data Rooms Plus tiers and above, or when the
 * requestList feature flag explicitly enables it for the current team.
 */
export function useRequestListFeatureEnabled(): boolean {
  const { isFeatureEnabled } = useFeatureFlags();
  const { originalPlan } = usePlan();

  return (
    teamPlanIsDataroomPlusTier(originalPlan) || isFeatureEnabled("requestList")
  );
}
