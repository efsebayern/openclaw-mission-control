import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@/api/mutator";
import { formatRelativeTimestamp } from "@/lib/formatters";
import { toast } from "react-hot-toast";

export function GatewayApprovalsCard({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  
  const { data, isLoading } = useQuery({
    queryKey: ["board-approvals", boardId],
    queryFn: async () => {
      const response = await customFetch<any>(`/api/v1/boards/${boardId}/approvals?status=pending`, { 
        method: "GET" 
      });
      return response.data;
    },
    refetchInterval: 10000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: "approved" | "rejected" }) => {
      await customFetch(`/api/v1/boards/${boardId}/approvals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      toast.success("Response sent to agent");
      queryClient.invalidateQueries({ queryKey: ["board-approvals", boardId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send response");
    }
  });

  const pending = data?.items || [];

  if (isLoading && !data) return <div className="animate-pulse h-24 bg-slate-50 rounded-xl" />;
  if (pending.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">Action Required</p>
      {pending.map((approval: any) => (
        <div key={approval.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-sm font-bold text-slate-900">{approval.action_type}</p>
              <p className="text-xs text-slate-600 italic">Confidence: {approval.confidence * 100}%</p>
            </div>
            <span className="text-[10px] text-slate-500">{formatRelativeTimestamp(approval.created_at)}</span>
          </div>
          
          <div className="bg-white border border-amber-100 rounded-lg p-3 mb-3 text-xs font-mono max-h-32 overflow-y-auto">
            {typeof approval.payload === 'object' ? JSON.stringify(approval.payload, null, 2) : approval.payload}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => resolveMutation.mutate({ id: approval.id, status: "approved" })}
              disabled={resolveMutation.isPending}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => resolveMutation.mutate({ id: approval.id, status: "rejected" })}
              disabled={resolveMutation.isPending}
              className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
