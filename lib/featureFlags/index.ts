export type BetaFeatures =
 | "tokens"
 | "incomingWebhooks"
 | "roomChangeNotifications"
 | "webhooks"
 | "conversations"
 | "dataroomUpload"
 | "inDocumentLinks"
 | "usStorage"
 | "dataroomIndex"
 | "slack"
 | "annotations"
 | "dataroomInvitations"
 | "workflows"
 | "ai"
 | "sso"
 | "textSelection";

type BetaFeaturesRecord = Record<BetaFeatures, string[]>;

export const getFeatureFlags = async ({ teamId }: { teamId?: string }) => {
 return {
   tokens: true,
   incomingWebhooks: true,
   roomChangeNotifications: true,
   webhooks: true,
   conversations: true,
   dataroomUpload: true,
   inDocumentLinks: true,
   usStorage: false,
   dataroomIndex: true,
   slack: true,
   annotations: true,
   dataroomInvitations: true,
   workflows: true,
   ai: false,
   sso: false,
   textSelection: true,
 };
};
