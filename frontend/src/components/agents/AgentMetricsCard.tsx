import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/mutator";

type AgentMetrics = {
  usage?: {
    totalTokens?: number;
    percentUsed?: number;
    model?: string;
  };
  heartbeat?: {
    enabled: boolean;
    every: string;
  };
};

export function AgentMetricsCard({ agentId, gatewayId }: { agentId: string, gatewayId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gateway-metrics", gatewayId],
    queryFn: async () => {
      const response = await customFetch<any>(`/api/v1/gateways/${gatewayId}/metrics`, { method: "GET" });
      return response.data;
    },
    refetchInterval: 30000,
  });

  const usage = data?.usage?.byAgent?.[agentId];
  const heartbeat = data?.runtime?.heartbeat?.agents?.find((a: any) => a.agentId === agentId);

  if (isLoading) return <div className="animate-pulse h-20 bg-slate-100 rounded-xl" />;

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet mb-4">Live Performance</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-quiet">Token Usage</p>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-strong">
              {usage?.totalTokens?.toLocaleString() ?? "0"}
            </span>
            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
              {usage?.model || "n/a"}
            </span>
          </div>
          {usage?.percentUsed !== undefined && (
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
              <div 
                className="bg-blue-500 h-full transition-all duration-500" 
                style={{ width: `${Math.min(100, usage.percentUsed)}%` }} 
              />
            </div>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-xs text-quiet">Heartbeat Schedule</p>
          <p className="text-sm font-medium text-strong">
            {heartbeat?.enabled ? `Every ${heartbeat.every}` : "Manual only"}
          </p>
          <p className="text-[10px] text-quiet italic">
            {heartbeat?.enabled ? "Active background loop" : "Standby mode"}
          </p>
        </div>
      </div>
    </div>
  );
}
