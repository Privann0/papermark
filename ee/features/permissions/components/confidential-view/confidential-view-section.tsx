import { useEffect, useState } from "react";

import type { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import LinkItem from "@/components/links/link-sheet/link-item";
import type { LinkUpgradeOptions } from "@/components/links/link-sheet/link-options";

export default function ConfidentialViewSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
    highlightItem,
  }: LinkUpgradeOptions) => void;
}) {
  const { enableConfidentialView } = data;
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(enableConfidentialView);
  }, [enableConfidentialView]);

  const handleToggle = () => {
    const nextEnabled = !enabled;

    setData({
      ...data,
      enableConfidentialView: nextEnabled,
    });
    setEnabled(nextEnabled);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Confidential view"
        tooltipContent="Reveal only a narrow section of the document at a time while the rest stays blurred."
        link="https://www.papermark.com/screenshot-protection"
        enabled={enabled}
        action={handleToggle}
        isAllowed={isAllowed}
        requiredPlan="business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_confidential_view_section",
            plan: "Business",
            highlightItem: ["confidential-view"],
          })
        }
      />
    </div>
  );
}
