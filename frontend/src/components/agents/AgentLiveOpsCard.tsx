"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  MessageSquare,
  Pin,
  Play,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "react-hot-toast";

import type { AgentRead, BoardRead } from "@/api/generated/model";
import { formatRelativeTimestamp, formatTimestamp } from "@/lib/formatters";
import {
  buildCommandCenterHref,
  fetchGatewayStatus,
  fetchSessionHistory,
  findSessionForAgent,
  normalizeLiveSessions,
  normalizeSessionHistory,
  postSessionAction,
  postSessionMessage,
} from "@/lib/openclaw-live";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DASH = "—";

function formatTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function AgentLiveOpsCard({
  agent,
  boards,
}: {
  agent: AgentRead;
  boards: BoardRead[];
}) {
  const [draftMessage, setDraftMessage] = useState("");
  const linkedBoard = agent.board_id
    ? (boards.find((board) => board.id === agent.board_id) ?? null)
    : null;

  const gatewayStatusQuery = useQuery({
    queryKey: ["agent-live-ops", "gateway-status", agent.gateway_id],
    queryFn: () => fetchGatewayStatus(agent.gateway_id),
    enabled: Boolean(agent.gateway_id),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false,
  });

  const liveSessions = useMemo(
    () => normalizeLiveSessions(gatewayStatusQuery.data?.sessions),
    [gatewayStatusQuery.data?.sessions],
  );
  const selectedSession = useMemo(
    () => findSessionForAgent(agent, liveSessions),
    [agent, liveSessions],
  );

  const sessionHistoryQuery = useQuery({
    queryKey: [
      "agent-live-ops",
      "session-history",
      agent.gateway_id,
      selectedSession?.key ?? "none",
    ],
    queryFn: () => fetchSessionHistory(agent.gateway_id, selectedSession?.key ?? ""),
    enabled: Boolean(agent.gateway_id && selectedSession?.key),
    refetchInterval: 5_000,
    staleTime: 2_000,
    retry: false,
  });

  const history = useMemo(
    () => normalizeSessionHistory(sessionHistoryQuery.data?.history).slice(-8).reverse(),
    [sessionHistoryQuery.data?.history],
  );

  const commandCenterHref = buildCommandCenterHref({
    gatewayId: agent.gateway_id,
    sessionKey: selectedSession?.key ?? agent.openclaw_session_id,
    boardId: linkedBoard?.id ?? null,
    agentId: agent.id,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSession?.key) throw new Error("No live session is mapped to this agent");
      await postSessionMessage(agent.gateway_id, selectedSession.key, draftMessage.trim());
    },
    onSuccess: () => {
      toast.success("Instruction sent to live agent");
      setDraftMessage("");
      void sessionHistoryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to send instruction";
      toast.error(message);
    },
  });

  const quickCommandMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedSession?.key) throw new Error("No live session is mapped to this agent");
      await postSessionMessage(agent.gateway_id, selectedSession.key, content);
    },
    onSuccess: (_, command) => {
      toast.success(`${command} sent`);
      void sessionHistoryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to send live command";
      toast.error(message);
    },
  });

  const sessionActionMutation = useMutation({
    mutationFn: async (action: "reset" | "delete") => {
      if (!selectedSession?.key) throw new Error("No live session is mapped to this agent");
      await postSessionAction(agent.gateway_id, selectedSession.key, action);
    },
    onSuccess: (_, action) => {
      toast.success(action === "reset" ? "Session reset" : "Session deleted");
      void gatewayStatusQuery.refetch();
      void sessionHistoryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update session";
      toast.error(message);
    },
  });

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet">
            Live ops
          </p>
          <p className="mt-1 text-lg font-semibold text-strong">
            {selectedSession ? "Real OpenClaw session attached" : "No live session attached"}
          </p>
          <p className="mt-1 text-sm text-muted">
            Manage the real runtime session behind this agent.
          </p>
        </div>
        <div
          className={[
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            selectedSession
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {selectedSession ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {selectedSession ? "Live" : "Offline"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet">
            Session
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted">
            {selectedSession?.key ?? agent.openclaw_session_id ?? DASH}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet">
            Gateway link
          </p>
          <p className="mt-1 text-sm text-muted">
            {gatewayStatusQuery.data?.connected ? "Connected" : "Waiting for live gateway"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet">
            Last activity
          </p>
          <p className="mt-1 text-sm text-strong">
            {selectedSession?.updatedAt
              ? formatRelativeTimestamp(selectedSession.updatedAt)
              : formatRelativeTimestamp(agent.last_seen_at)}
          </p>
          <p className="text-xs text-quiet">
            {formatTimestamp(selectedSession?.updatedAt ?? agent.last_seen_at)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-quiet">
            Runtime
          </p>
          <p className="mt-1 text-sm text-muted">
            {selectedSession?.model ?? DASH} · {selectedSession?.channel ?? DASH}
          </p>
          <p className="text-xs text-quiet">
            {formatTokens(selectedSession?.totalTokens ?? null)} tokens ·{" "}
            {formatMoney(selectedSession?.estimatedCostUsd ?? null)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={commandCenterHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <ArrowUpRight className="h-4 w-4" />
          Open session
        </Link>
        <Link
          href={commandCenterHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <Pin className="h-4 w-4" />
          Handoff
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => quickCommandMutation.mutate("/pause")}
          disabled={!selectedSession || quickCommandMutation.isPending}
        >
          <ShieldAlert className="h-4 w-4" />
          Pause
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => quickCommandMutation.mutate("/resume")}
          disabled={!selectedSession || quickCommandMutation.isPending}
        >
          <Play className="h-4 w-4" />
          Resume
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => sessionActionMutation.mutate("reset")}
          disabled={!selectedSession || sessionActionMutation.isPending}
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => sessionActionMutation.mutate("delete")}
          disabled={!selectedSession || sessionActionMutation.isPending}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      <div className="mt-5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-strong">Recent live transcript</p>
            <p className="text-xs text-muted">
              Latest messages from the real OpenClaw session.
            </p>
          </div>
          <Link
            href={commandCenterHref}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--accent)]"
          >
            Full inspector
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-3 max-h-[280px] space-y-3 overflow-y-auto">
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm text-muted">
              {selectedSession
                ? "No live history available yet."
                : "This agent has no live gateway session to inspect right now."}
            </div>
          ) : (
            history.map((message) => (
              <div
                key={message.id}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {message.role}
                  </span>
                  <span className="text-[11px] text-quiet">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-strong">
                  {message.content}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-quiet">
            Delegate or steer
          </label>
          <Textarea
            className="mt-2 min-h-[108px] bg-[color:var(--surface)]"
            placeholder="Send an instruction into the real OpenClaw session..."
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Message is sent to the live agent session, not a mirrored copy.
            </p>
            <Button
              type="button"
              onClick={() => sendMutation.mutate()}
              disabled={!selectedSession || sendMutation.isPending || !draftMessage.trim()}
            >
              <SendHorizontal className="h-4 w-4" />
              {sendMutation.isPending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
