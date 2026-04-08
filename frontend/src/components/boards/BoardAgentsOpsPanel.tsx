"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Pause, Play, Plus, Wifi, WifiOff } from "lucide-react";
import { toast } from "react-hot-toast";

import type { AgentRead, BoardRead, TaskCardRead } from "@/api/generated/model";
import { formatRelativeTimestamp, formatTimestamp } from "@/lib/formatters";
import {
  buildCommandCenterHref,
  fetchGatewayStatus,
  findSessionForAgent,
  normalizeLiveSessions,
  postSessionMessage,
} from "@/lib/openclaw-live";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusDot } from "@/components/atoms/StatusDot";
import { cn } from "@/lib/utils";

type AgentTaskSummary = {
  total: number;
  inProgress: number;
  review: number;
  done: number;
  lastTaskUpdate: string | null;
};

const summarizeTasks = (
  agentId: string,
  tasks: TaskCardRead[],
): AgentTaskSummary => {
  const assigned = tasks.filter((task) => task.assigned_agent_id === agentId);
  const updatedAt = assigned
    .map((task) => task.updated_at)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return {
    total: assigned.length,
    inProgress: assigned.filter((task) => task.status === "in_progress").length,
    review: assigned.filter((task) => task.status === "review").length,
    done: assigned.filter((task) => task.status === "done").length,
    lastTaskUpdate: updatedAt,
  };
};

export function BoardAgentsOpsPanel({
  board,
  agents,
  tasks,
  workingAgentIds,
  onAddAgent,
  onOpenAgent,
}: {
  board: BoardRead;
  agents: AgentRead[];
  tasks: TaskCardRead[];
  workingAgentIds: Set<string>;
  onAddAgent: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const gatewayStatusQuery = useQuery({
    queryKey: ["board-agent-ops", "gateway-status", board.gateway_id],
    queryFn: () => fetchGatewayStatus(board.gateway_id as string),
    enabled: Boolean(board.gateway_id),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false,
  });

  const liveSessions = useMemo(
    () => normalizeLiveSessions(gatewayStatusQuery.data?.sessions),
    [gatewayStatusQuery.data?.sessions],
  );

  const sessionCommandMutation = useMutation({
    mutationFn: async ({
      gatewayId,
      sessionKey,
      command,
    }: {
      gatewayId: string;
      sessionKey: string;
      command: "/pause" | "/resume";
    }) => {
      await postSessionMessage(gatewayId, sessionKey, command);
    },
    onSuccess: (_, variables) => {
      toast.success(`${variables.command} sent`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update live agent";
      toast.error(message);
    },
  });

  return (
    <aside className="flex w-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm md:h-full md:w-[22rem]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Agents
          </p>
          <p className="text-xs text-slate-400">{agents.length} live board operators</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAddAgent}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
            No agents assigned yet.
          </div>
        ) : (
          agents.map((agent) => {
            const isWorking = workingAgentIds.has(agent.id);
            const liveSession = findSessionForAgent(agent, liveSessions);
            const taskSummary = summarizeTasks(agent.id, tasks);
            const lastSignal =
              liveSession?.updatedAt ??
              taskSummary.lastTaskUpdate ??
              agent.last_seen_at ??
              null;
            const commandCenterHref = buildCommandCenterHref({
              gatewayId: agent.gateway_id,
              sessionKey: liveSession?.key ?? agent.openclaw_session_id,
              boardId: board.id,
              agentId: agent.id,
            });

            return (
              <div
                key={agent.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => onOpenAgent(agent.id)}
                  >
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                      {agent.name
                        .split(/\s+/)
                        .map((part) => part[0] ?? "")
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                      <StatusDot
                        status={agent.status}
                        variant="agent"
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
                          isWorking && "ring-2 ring-emerald-200",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {agent.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>{agent.is_board_lead ? "Board lead" : "Board agent"}</span>
                        <span className="text-slate-300">·</span>
                        <span>{taskSummary.inProgress} active</span>
                        <span className="text-slate-300">·</span>
                        <span>{taskSummary.review} review</span>
                      </div>
                    </div>
                  </button>
                  <div
                    className={[
                      "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
                      liveSession
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600",
                    ].join(" ")}
                  >
                    {liveSession ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {liveSession ? "Live" : "Imported"}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-[11px] text-slate-500">
                  <div className="flex items-center justify-between gap-3">
                    <span>Last signal</span>
                    <span title={formatTimestamp(lastSignal)}>
                      {lastSignal ? formatRelativeTimestamp(lastSignal) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Queue</span>
                    <span>
                      {taskSummary.total} total · {taskSummary.done} done
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Session</span>
                    <span className="truncate font-mono" title={liveSession?.key ?? "—"}>
                      {liveSession?.key ?? "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" type="button" onClick={() => onOpenAgent(agent.id)}>
                    <Activity className="h-4 w-4" />
                    Profile
                  </Button>
                  <Link
                    href={commandCenterHref}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Session
                  </Link>
                  <Link
                    href={commandCenterHref}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Handoff
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={!liveSession || sessionCommandMutation.isPending}
                    onClick={() =>
                      liveSession
                        ? sessionCommandMutation.mutate({
                            gatewayId: agent.gateway_id,
                            sessionKey: liveSession.key,
                            command: "/pause",
                          })
                        : undefined
                    }
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={!liveSession || sessionCommandMutation.isPending}
                    onClick={() =>
                      liveSession
                        ? sessionCommandMutation.mutate({
                            gatewayId: agent.gateway_id,
                            sessionKey: liveSession.key,
                            command: "/resume",
                          })
                        : undefined
                    }
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
