import { useEffect, useState } from "react";

import { useRequestListFeatureEnabled } from "@/ee/features/request-lists/lib/use-request-list-feature";
import { ListChecksIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface RequestListSettingsCardProps {
  dataroomId: string;
  teamId: string;
  requestListEnabled: boolean;
}

export function RequestListSettingsCard({
  dataroomId,
  teamId,
  requestListEnabled: initialEnabled,
}: RequestListSettingsCardProps) {
  const featureEnabled = useRequestListFeatureEnabled();
  const [requestListEnabled, setRequestListEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRequestListEnabled(initialEnabled);
  }, [initialEnabled]);

  if (!featureEnabled) {
    return null;
  }

  const handleToggle = async (enabled: boolean) => {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestListEnabled: enabled,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.message ||
            body?.error ||
            "Failed to update Request List setting",
        );
      }

      setRequestListEnabled(enabled);

      await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);

      toast.success(`Request List ${enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      console.error("Error toggling Request List:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update Request List setting",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ListChecksIcon className="h-5 w-5 text-primary" />
          <CardTitle>Request List</CardTitle>
        </div>

        <CardDescription>
          Create a due-diligence checklist of requests, assign them to visitors
          or groups, and track completion.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor="request-list-enabled"
            className="flex flex-col space-y-1"
          >
            <span>Enable Request List</span>
            <span className="text-xs font-normal leading-snug text-muted-foreground">
              Show assigned requests to visitors in this data room.
            </span>
          </Label>

          <Switch
            id="request-list-enabled"
            checked={requestListEnabled}
            onCheckedChange={handleToggle}
            disabled={loading}
          />
        </div>
      </CardContent>
    </Card>
  );
}
