import { useDataroom } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { TabMenu } from "@/components/tab-menu";
import DataroomVisitorsTable from "@/components/visitors/dataroom-visitors-table";

export default function DataroomAnalyticsPage() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Analytics
          </h3>
          <p className="text-sm text-muted-foreground">
            View data room engagement and visitor activity.
          </p>
        </div>

        <TabMenu
          navigation={[
            {
              label: "Analytics",
              href: `/datarooms/${dataroom.id}/analytics`,
              value: "analytics",
              currentValue: "analytics",
            },
            {
              label: "Audit Log",
              href: `/datarooms/${dataroom.id}/analytics/audit-log`,
              value: "audit-log",
              currentValue: "analytics",
            },
          ]}
          className="md:hidden"
        />

        <DataroomVisitorsTable dataroomId={dataroom.id} />
      </div>
    </AppLayout>
  );
}
