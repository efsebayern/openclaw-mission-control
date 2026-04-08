"use client";

export const dynamic = "force-dynamic";

import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { LiveCommandCenter } from "@/components/command-center/LiveCommandCenter";

import { useAuth } from "@/auth/clerk";
import { useOrganizationMembership } from "@/lib/use-organization-membership";

export default function CommandCenterPage() {
  const { isSignedIn } = useAuth();
  const { isAdmin } = useOrganizationMembership(isSignedIn);

  return (
    <DashboardPageLayout
      signedOut={{
        message: "Sign in to access the live command center.",
        forceRedirectUrl: "/command-center",
      }}
      title="Command Center"
      description="Live OpenClaw operations: observe, delegate, and steer real agent sessions."
      isAdmin={isAdmin}
      adminOnlyMessage="Only organization owners and admins can access the command center."
      stickyHeader
    >
      <LiveCommandCenter />
    </DashboardPageLayout>
  );
}
