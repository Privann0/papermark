import type { ReactNode } from "react";

import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type CollapsibleBrandingSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function CollapsibleBrandingSection({
  title,
  children,
  defaultOpen = false,
}: CollapsibleBrandingSectionProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left text-sm font-medium">
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t px-6 py-6">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default CollapsibleBrandingSection;
