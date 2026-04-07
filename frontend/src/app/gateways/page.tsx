"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/auth/clerk";
import { useQueryClient } from "@tanstack/react-query";

import { GatewaysTable } from "@/components/gateways/GatewaysTable";
import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

import { ApiError } from "@/api/mutator";
import {
  type listGatewaysApiV1GatewaysGetResponse,
  getListGatewaysApiV1GatewaysGetQueryKey,
  useDeleteGatewayApiV1GatewaysGatewayIdDelete,
  useListGatewaysApiV1GatewaysGet,
} from "@/api/generated/gateways/gateways";
import { createOptimisticListDeleteMutation } from "@/lib/list-delete";
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import type { GatewayRead } from "@/api/generated/model";
import { useUrlSorting } from "@/lib/use-url-sorting";
import { useMutation } from "@tanstack/react-query";
import { toast } from "react-hot-toast";
import { customFetch } from "@/api/mutator";

const GATEWAY_SORTABLE_COLUMNS = ["name", "workspace_root", "updated_at"];

export default function GatewaysPage() {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const { sorting, onSortingChange } = useUrlSorting({
    allowedColumnIds: GATEWAY_SORTABLE_COLUMNS,
    defaultSorting: [{ id: "name", desc: false }],
    paramPrefix: "gateways",
  });

  const [deleteTarget, setDeleteTarget] = useState<GatewayRead | null>(null);
  const [syncAgentsTarget, setSyncAgentsTarget] = useState<GatewayRead | null>(null);
  const [syncTemplatesTarget, setSyncTemplatesTarget] = useState<GatewayRead | null>(
    null,
  );

  const gatewaysKey = getListGatewaysApiV1GatewaysGetQueryKey();
  const gatewaysQuery = useListGatewaysApiV1GatewaysGet<
    listGatewaysApiV1GatewaysGetResponse,
    ApiError
  >(undefined, {
    query: {
      enabled: Boolean(isSignedIn && isAdmin),
      refetchInterval: 30_000,
      refetchOnMount: "always",
    },
  });

  const gateways = useMemo(
    () =>
      gatewaysQuery.data?.status === 200
        ? (gatewaysQuery.data.data.items ?? [])
        : [],
    [gatewaysQuery.data],
  );

  const deleteMutation = useDeleteGatewayApiV1GatewaysGatewayIdDelete<
    ApiError,
    { previous?: listGatewaysApiV1GatewaysGetResponse }
  >(
    {
      mutation: createOptimisticListDeleteMutation<
        GatewayRead,
        listGatewaysApiV1GatewaysGetResponse,
        { gatewayId: string }
      >({
        queryClient,
        queryKey: gatewaysKey,
        getItemId: (gateway) => gateway.id,
        getDeleteId: ({ gatewayId }) => gatewayId,
        onSuccess: () => {
          setDeleteTarget(null);
        },
        invalidateQueryKeys: [gatewaysKey],
      }),
    },
    queryClient,
  );

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ gatewayId: deleteTarget.id });
  };

  const syncAgentsMutation = useMutation({
    mutationFn: async (gatewayId: string) => {
      const response = await customFetch<any>(`/api/v1/gateways/${gatewayId}/sync-agents`, {
        method: "POST",
      });
      return response.data;
    },
    onSuccess: (data: any) => {
      toast.success(`Successfully synchronized ${data.length} agents.`);
      queryClient.invalidateQueries({ queryKey: ["/api/v1/agents"] });
      setSyncAgentsTarget(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to sync agents.");
      setSyncAgentsTarget(null);
    },
  });

  const syncTemplatesMutation = useMutation({
    mutationFn: async (gatewayId: string) => {
      const response = await customFetch<any>(
        `/api/v1/gateways/${gatewayId}/sync-templates`,
        {
          method: "POST",
        },
      );
      return response.data;
    },
    onSuccess: () => {
      toast.success("Successfully synchronized templates.");
      setSyncTemplatesTarget(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to sync templates.");
      setSyncTemplatesTarget(null);
    },
  });

  return (
    <>
      <DashboardPageLayout
        signedOut={{
          message: "Sign in to view gateways.",
          forceRedirectUrl: "/gateways",
        }}
        title="Gateways"
        description="Manage OpenClaw gateway connections used by boards"
        headerActions={
          isAdmin && gateways.length > 0 ? (
            <Link
              href="/gateways/new"
              className={buttonVariants({
                size: "md",
                variant: "primary",
              })}
            >
              Create gateway
            </Link>
          ) : null
        }
        isAdmin={isAdmin}
        adminOnlyMessage="Only organization owners and admins can access gateways."
        stickyHeader
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <GatewaysTable
            gateways={gateways}
            isLoading={gatewaysQuery.isLoading}
            sorting={sorting}
            onSortingChange={onSortingChange}
            showActions
            stickyHeader
            onSyncAgents={setSyncAgentsTarget}
            onSyncTemplates={setSyncTemplatesTarget}
            onDelete={setDeleteTarget}
            emptyState={{
              title: "No gateways yet",
              description:
                "Create your first gateway to connect boards and start managing your OpenClaw connections.",
              actionHref: "/gateways/new",
              actionLabel: "Create your first gateway",
            }}
          />
        </div>

        {gatewaysQuery.error ? (
          <p className="mt-4 text-sm text-red-500">
            {gatewaysQuery.error.message}
          </p>
        ) : null}
      </DashboardPageLayout>

      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={() => setDeleteTarget(null)}
        title="Delete gateway?"
        description={
          <>
            This removes the gateway connection from Mission Control. Boards
            using it will need a new gateway assigned.
          </>
        }
        errorMessage={deleteMutation.error?.message}
        errorStyle="text"
        cancelVariant="ghost"
        onConfirm={handleDelete}
        isConfirming={deleteMutation.isPending}
      />

      <ConfirmActionDialog
        open={Boolean(syncAgentsTarget)}
        onOpenChange={() => setSyncAgentsTarget(null)}
        title="Synchronize Agents?"
        description={
          <>
            This will fetch all existing agents from the gateway "
            <strong>{syncAgentsTarget?.name}</strong>" and import them into
            Mission Control.
          </>
        }
        confirmLabel="Sync now"
        cancelVariant="ghost"
        onConfirm={() =>
          syncAgentsTarget && syncAgentsMutation.mutate(syncAgentsTarget.id)
        }
        isConfirming={syncAgentsMutation.isPending}
      />

      <ConfirmActionDialog
        open={Boolean(syncTemplatesTarget)}
        onOpenChange={() => setSyncTemplatesTarget(null)}
        title="Synchronize Templates?"
        description={
          <>
            This will synchronize all templates for the gateway "
            <strong>{syncTemplatesTarget?.name}</strong>".
          </>
        }
        confirmLabel="Sync templates"
        cancelVariant="ghost"
        onConfirm={() =>
          syncTemplatesTarget &&
          syncTemplatesMutation.mutate(syncTemplatesTarget.id)
        }
        isConfirming={syncTemplatesMutation.isPending}
      />
    </>
  );
}
