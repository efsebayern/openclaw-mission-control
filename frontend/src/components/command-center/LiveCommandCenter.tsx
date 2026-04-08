"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  MessageSquare,
  RefreshCw,
  SendHorizontal,
  TerminalSquare,
  Wrench,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "react-hot-toast";

import { useAuth } from "@/auth/clerk";
import { ApiError, customFetch } from "@/api/mutator";
import {
  type listAgentsApiV1AgentsGetResponse,
  useListAgentsApiV1AgentsGet,
} from "@/api/generated/agents/agents";
import {
  type listBoardsApiV1BoardsGetResponse,
  useListBoardsApiV1BoardsGet,
} from "@/api/generated/boards/boards";
import {
  type listGatewaysApiV1GatewaysGetResponse,
  useListGatewaysApiV1GatewaysGet,
} from "@/api/generated/gateways/gateways";
import { createTaskApiV1BoardsBoardIdTasksPost } from "@/api/generated/tasks/tasks";
import type { TaskCreate } from "@/api/generated/model";
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import { readPinnedSessionKeys, writePinnedSessionKeys } from "@/lib/command-center-state";
import { formatRelativeTimestamp, formatTimestamp } from "@/lib/formatters";
import {
  fetchGatewayStatus,
  fetchSessionHistory,
  type GatewayStatusPayload,
  normalizeLiveSessions,
  normalizeSessionHistory,
  postSessionAction,
  postSessionMessage,
  type SessionSummary,
} from "@/lib/openclaw-live";
import { buildAgentLookup, resolveManagedAgent } from "@/lib/openclaw-session-mapping";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DASH = "—";

type ApiResponse<T> = {
  data: T;
  headers: Headers;
  status: number;
};

const formatMoney = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return DASH;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

export function LiveCommandCenter() {
  const { isSignedIn } = useAuth();
  const { isAdmin } = useOrganizationMembership(isSignedIn);
  const searchParams = useSearchParams();
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "managed" | "external">("all");
  const [pinnedSessionKeys, setPinnedSessionKeys] = useState<string[]>(() => readPinnedSessionKeys());
  const [handoffBoardId, setHandoffBoardId] = useState("");
  const [handoffAgentId, setHandoffAgentId] = useState("");
  const [handoffTitle, setHandoffTitle] = useState("");
  const [handoffDescription, setHandoffDescription] = useState("");
  const gatewayIdFromUrl = searchParams.get("gateway");
  const sessionKeyFromUrl = searchParams.get("session");
  const handoffBoardIdFromUrl = searchParams.get("handoffBoard");
  const handoffAgentIdFromUrl = searchParams.get("handoffAgent");

  const gatewaysQuery = useListGatewaysApiV1GatewaysGet<
    listGatewaysApiV1GatewaysGetResponse,
    ApiError
  >(undefined, {
    query: {
      enabled: Boolean(isSignedIn && isAdmin),
      refetchInterval: 20_000,
      refetchOnMount: "always",
    },
  });

  const agentsQuery = useListAgentsApiV1AgentsGet<
    listAgentsApiV1AgentsGetResponse,
    ApiError
  >(undefined, {
    query: {
      enabled: Boolean(isSignedIn && isAdmin),
      refetchInterval: 20_000,
      refetchOnMount: "always",
    },
  });

  const boardsQuery = useListBoardsApiV1BoardsGet<
    listBoardsApiV1BoardsGetResponse,
    ApiError
  >(undefined, {
    query: {
      enabled: Boolean(isSignedIn && isAdmin),
      refetchInterval: 20_000,
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

  const agents = useMemo(
    () =>
      agentsQuery.data?.status === 200 ? (agentsQuery.data.data.items ?? []) : [],
    [agentsQuery.data],
  );

  const boards = useMemo(
    () =>
      boardsQuery.data?.status === 200 ? (boardsQuery.data.data.items ?? []) : [],
    [boardsQuery.data],
  );

  const gatewayStatusQueries = useQueries({
    queries: gateways.map((gateway) => ({
      queryKey: ["live-command-center", "gateway-status", gateway.id],
      queryFn: () => fetchGatewayStatus(gateway.id),
      enabled: Boolean(isSignedIn && isAdmin),
      refetchInterval: 15_000,
      staleTime: 5_000,
      retry: false,
    })),
  });

  const gatewayStatusById = useMemo(() => {
    const entries: Array<[string, GatewayStatusPayload | null]> = gateways.map(
      (gateway, index) => [gateway.id, gatewayStatusQueries[index]?.data ?? null],
    );
    return new Map(entries);
  }, [gatewayStatusQueries, gateways]);

  const effectiveSelectedGatewayId =
    selectedGatewayId && gateways.some((gateway) => gateway.id === selectedGatewayId)
      ? selectedGatewayId
      : gatewayIdFromUrl && gateways.some((gateway) => gateway.id === gatewayIdFromUrl)
        ? gatewayIdFromUrl
      : (gateways[0]?.id ?? null);

  const selectedGateway =
    gateways.find((gateway) => gateway.id === effectiveSelectedGatewayId) ?? null;

  const selectedGatewayStatus = effectiveSelectedGatewayId
    ? gatewayStatusById.get(effectiveSelectedGatewayId) ?? null
    : null;

  const liveSessions = useMemo(() => {
    return normalizeLiveSessions(selectedGatewayStatus?.sessions);
  }, [selectedGatewayStatus]);

  const effectiveSelectedSessionKey =
    selectedSessionKey &&
    liveSessions.some((session) => session.key === selectedSessionKey)
      ? selectedSessionKey
      : sessionKeyFromUrl &&
          liveSessions.some((session) => session.key === sessionKeyFromUrl)
        ? sessionKeyFromUrl
      : (liveSessions[0]?.key ?? null);

  const sessionHistoryQuery = useQuery({
    queryKey: [
      "live-command-center",
      "session-history",
      selectedGateway?.id ?? "none",
      effectiveSelectedSessionKey ?? "none",
    ],
    queryFn: () => {
      if (!selectedGateway || !effectiveSelectedSessionKey) {
        throw new Error("A selected gateway session is required");
      }
      return fetchSessionHistory(selectedGateway.id, effectiveSelectedSessionKey);
    },
    enabled: Boolean(isSignedIn && isAdmin && selectedGateway && effectiveSelectedSessionKey),
    refetchInterval: 5_000,
    staleTime: 2_000,
    retry: false,
  });

  const selectedSession =
    liveSessions.find((session) => session.key === effectiveSelectedSessionKey) ?? null;
  const selectedHistory = useMemo(() => {
    return normalizeSessionHistory(sessionHistoryQuery.data?.history);
  }, [sessionHistoryQuery.data]);

  const boardById = useMemo(
    () => new Map(boards.map((board) => [board.id, board] as const)),
    [boards],
  );

  const agentLookup = useMemo(() => buildAgentLookup(agents), [agents]);
  const pinnedSessionKeySet = useMemo(() => new Set(pinnedSessionKeys), [pinnedSessionKeys]);

  const sessionRows = useMemo(
    () =>
      liveSessions.map((session) => {
        const agent = resolveManagedAgent(session.key, agentLookup);
        const board = agent?.board_id ? (boardById.get(agent.board_id) ?? null) : null;
        const pinned = pinnedSessionKeySet.has(session.key);
        return { session, agent, board, pinned };
      }),
    [agentLookup, boardById, liveSessions, pinnedSessionKeySet],
  );

  const filteredSessionRows = useMemo(() => {
    const normalizedFilter = sessionFilter.trim().toLowerCase();
    return sessionRows
      .filter(({ session, agent, board }) => {
        if (statusFilter === "managed" && !agent) return false;
        if (statusFilter === "external" && agent) return false;
        if (statusFilter === "running" && session.status !== "running") return false;
        if (!normalizedFilter) return true;
        const haystack = [
          session.label,
          session.key,
          session.channel,
          session.model,
          agent?.name,
          board?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedFilter);
      })
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        const leftTs = left.session.updatedAt ? Date.parse(left.session.updatedAt) : 0;
        const rightTs = right.session.updatedAt ? Date.parse(right.session.updatedAt) : 0;
        return rightTs - leftTs;
      });
  }, [sessionFilter, sessionRows, statusFilter]);

  const selectedManagedAgent = selectedSession ? resolveManagedAgent(selectedSession.key, agentLookup) : null;
  const selectedManagedBoard =
    selectedManagedAgent?.board_id ? (boardById.get(selectedManagedAgent.board_id) ?? null) : null;
  const effectiveHandoffBoardId =
    handoffBoardId || handoffBoardIdFromUrl || selectedManagedBoard?.id || "";
  const effectiveHandoffAgentId =
    handoffAgentId || handoffAgentIdFromUrl || selectedManagedAgent?.id || "";
  const effectiveHandoffTitle =
    handoffTitle || (selectedSession ? `Follow up ${selectedSession.label}` : "");
  const effectiveHandoffDescription =
    handoffDescription ||
    (selectedSession
      ? `Investigate or continue work from live OpenClaw session \`${selectedSession.key}\`.`
      : "");
  const boardAgentOptions = useMemo(
    () =>
      agents.filter((agent) =>
        effectiveHandoffBoardId ? agent.board_id === effectiveHandoffBoardId : false,
      ),
    [agents, effectiveHandoffBoardId],
  );

  useEffect(() => {
    writePinnedSessionKeys(pinnedSessionKeys);
  }, [pinnedSessionKeys]);

  const liveStats = useMemo(() => {
    const allSessions = gatewayStatusQueries.flatMap((query) =>
      normalizeLiveSessions(query.data?.sessions),
    ) as SessionSummary[];
    const runningSessions = allSessions.filter((session) => session.status === "running").length;
    const managedSessions = allSessions.filter(
      (session) => resolveManagedAgent(session.key, agentLookup) !== null,
    ).length;
    const connectedGateways = gatewayStatusQueries.filter((query) => query.data?.connected).length;
    return {
      connectedGateways,
      totalGateways: gateways.length,
      totalSessions: allSessions.length,
      runningSessions,
      managedSessions,
    };
  }, [agentLookup, gatewayStatusQueries, gateways.length]);

  const syncAgentsMutation = useMutation({
    mutationFn: async (gatewayId: string) => {
      const response = await customFetch<ApiResponse<unknown[]>>(
        `/api/v1/gateways/${gatewayId}/sync-agents`,
        { method: "POST" },
      );
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Synchronized ${data.length} agents`);
      void agentsQuery.refetch();
      void boardsQuery.refetch();
      void gatewaysQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to sync agents";
      toast.error(message);
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGateway || !effectiveSelectedSessionKey) return;
      await postSessionMessage(
        selectedGateway.id,
        effectiveSelectedSessionKey,
        draftMessage.trim(),
      );
    },
    onSuccess: () => {
      toast.success("Message sent to live session");
      setDraftMessage("");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to send message";
      toast.error(message);
    },
  });

  const quickCommandMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedGateway || !effectiveSelectedSessionKey) return;
      await postSessionMessage(selectedGateway.id, effectiveSelectedSessionKey, content);
    },
    onSuccess: (_, command) => {
      toast.success(`${command} sent to live session`);
      void sessionHistoryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to send live command";
      toast.error(message);
    },
  });

  const sessionActionMutation = useMutation({
    mutationFn: async (action: "reset" | "delete") => {
      if (!selectedGateway || !effectiveSelectedSessionKey) return;
      await postSessionAction(selectedGateway.id, effectiveSelectedSessionKey, action);
    },
    onSuccess: (_, action) => {
      toast.success(action === "reset" ? "Session reset" : "Session deleted");
      void gatewaysQuery.refetch();
      gatewayStatusQueries.forEach((query) => {
        void query.refetch();
      });
      void sessionHistoryQuery.refetch();
      if (action === "delete") {
        setSelectedSessionKey(null);
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update session";
      toast.error(message);
    },
  });

  const handoffTaskMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveHandoffBoardId || !effectiveHandoffTitle.trim()) {
        throw new Error("Board and title are required for a handoff task");
      }
      const payload: TaskCreate = {
        title: effectiveHandoffTitle.trim(),
        description: effectiveHandoffDescription.trim() || null,
        assigned_agent_id: effectiveHandoffAgentId || null,
        status: effectiveHandoffAgentId ? "in_progress" : "inbox",
        priority: "high",
      };
      return createTaskApiV1BoardsBoardIdTasksPost(effectiveHandoffBoardId, payload);
    },
    onSuccess: () => {
      toast.success("Handoff task created");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to create handoff task";
      toast.error(message);
    },
  });

  const togglePin = (sessionKey: string) => {
    setPinnedSessionKeys((current) =>
      current.includes(sessionKey)
        ? current.filter((key) => key !== sessionKey)
        : [sessionKey, ...current],
    );
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={<Wifi className="h-4 w-4" />}
          title="Connected gateways"
          value={`${liveStats.connectedGateways}/${liveStats.totalGateways}`}
          subtitle="Live OpenClaw links"
        />
        <SummaryCard
          icon={<Bot className="h-4 w-4" />}
          title="Live sessions"
          value={`${liveStats.totalSessions}`}
          subtitle="Real gateway sessions"
        />
        <SummaryCard
          icon={<Activity className="h-4 w-4" />}
          title="Running now"
          value={`${liveStats.runningSessions}`}
          subtitle="Active agent runs"
        />
        <SummaryCard
          icon={<TerminalSquare className="h-4 w-4" />}
          title="Managed sessions"
          value={`${liveStats.managedSessions}`}
          subtitle="Mapped into Mission Control"
        />
      </div>

      {gateways.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No gateways configured</h2>
          <p className="mt-2 text-sm text-slate-600">
            Create a gateway first so Mission Control can inspect and control real
            OpenClaw sessions.
          </p>
          <Link
            href="/gateways/new"
            className="mt-4 inline-flex h-11 items-center rounded-xl bg-[color:var(--accent)] px-5 text-sm font-semibold text-white"
          >
            Create gateway
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Gateways</h2>
                <p className="text-sm text-slate-500">Connected OpenClaw control planes</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedGateway ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => syncAgentsMutation.mutate(selectedGateway.id)}
                    disabled={syncAgentsMutation.isPending}
                  >
                    <Wrench className="h-4 w-4" />
                    Sync agents
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => gatewaysQuery.refetch()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {gateways.map((gateway, index) => {
                const status = gatewayStatusQueries[index];
                const live = gatewayStatusById.get(gateway.id);
                const selected = gateway.id === selectedGatewayId;
                const connected = live?.connected ?? false;

                return (
                  <button
                    key={gateway.id}
                    type="button"
                    onClick={() => setSelectedGatewayId(gateway.id)}
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      selected
                        ? "border-sky-300 bg-sky-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{gateway.name}</div>
                        <div className="mt-1 break-all text-xs text-slate-500">{gateway.url}</div>
                      </div>
                      <div
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
                          connected
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700",
                        ].join(" ")}
                      >
                        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {connected ? "Live" : "Offline"}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{live?.sessions_count ?? 0} sessions</span>
                      <span>{status?.isLoading ? "Refreshing..." : live?.error ?? "Ready"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Live agent sessions</h2>
              <p className="mt-1 text-sm text-slate-500">
                Real OpenClaw sessions from the selected gateway. Managed sessions are linked
                to Mission Control agents and boards.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={sessionFilter}
                    onChange={(event) => setSessionFilter(event.target.value)}
                    placeholder="Search sessions, agents, boards..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-300"
                  />
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "all" | "running" | "managed" | "external")
                  }
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-300"
                >
                  <option value="all">All sessions</option>
                  <option value="running">Running only</option>
                  <option value="managed">Managed only</option>
                  <option value="external">External only</option>
                </select>
              </div>
            </div>
            <div className="max-h-[760px] overflow-y-auto">
              {selectedGatewayStatus?.error ? (
                <div className="p-5 text-sm text-rose-600">{selectedGatewayStatus.error}</div>
              ) : filteredSessionRows.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No live sessions found.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredSessionRows.map(({ session, agent, board, pinned }) => {
                      const selected = session.key === effectiveSelectedSessionKey;
                    return (
                      <button
                        key={session.key}
                        type="button"
                        onClick={() => setSelectedSessionKey(session.key)}
                        className={[
                          "flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition",
                          selected ? "bg-sky-50" : "hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {session.label}
                            </span>
                            {pinned ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                Pinned
                              </span>
                            ) : null}
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              {session.status}
                            </span>
                            {agent ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                Managed
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                External
                              </span>
                            )}
                          </div>
                          <div className="mt-2 break-all font-mono text-[11px] text-slate-500">
                            {session.key}
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                            <span>Board: {board?.name ?? DASH}</span>
                            <span>Agent: {agent?.name ?? DASH}</span>
                            <span>Updated: {formatRelative(session.updatedAt)}</span>
                            <span>Model: {session.model ?? DASH}</span>
                            <span>Channel: {session.channel ?? DASH}</span>
                            <span>Children: {session.childSessionCount}</span>
                          </div>
                          {agent ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  togglePin(session.key);
                                }}
                                className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                {pinned ? "Unpin" : "Pin"}
                              </button>
                              <Link
                                href={`/agents/${agent.id}`}
                                className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Open agent
                              </Link>
                              {board ? (
                                <Link
                                  href={`/boards/${board.id}`}
                                  className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Open board
                                </Link>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-xs text-slate-500">
                          <div>{formatTokens(session.totalTokens)}</div>
                          <div className="mt-1">{formatMoney(session.estimatedCostUsd)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Session inspector</h2>
              <p className="mt-1 text-sm text-slate-500">
                Observe the live conversation and send instructions into the selected session.
              </p>
            </div>

            {selectedSession ? (
              <>
                <div className="space-y-3 border-b border-slate-200 px-5 py-4 text-sm">
                  <div className="font-semibold text-slate-900">{selectedSession.label}</div>
                  <div className="break-all font-mono text-[11px] text-slate-500">
                    {selectedSession.key}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                    <span>Status: {selectedSession.status}</span>
                    <span>Updated: {formatRelative(selectedSession.updatedAt)}</span>
                    <span>Started: {formatAbsolute(selectedSession.startedAt)}</span>
                    <span>Tokens: {formatTokens(selectedSession.totalTokens)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => togglePin(selectedSession.key)}
                    >
                      {pinnedSessionKeySet.has(selectedSession.key) ? (
                        <PinOff className="h-4 w-4" />
                      ) : (
                        <Pin className="h-4 w-4" />
                      )}
                      {pinnedSessionKeySet.has(selectedSession.key) ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => quickCommandMutation.mutate("/pause")}
                      disabled={quickCommandMutation.isPending}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Pause
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => quickCommandMutation.mutate("/resume")}
                      disabled={quickCommandMutation.isPending}
                    >
                      <Play className="h-4 w-4" />
                      Resume
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => sessionActionMutation.mutate("reset")}
                      disabled={sessionActionMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset session
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => sessionActionMutation.mutate("delete")}
                      disabled={sessionActionMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete session
                    </Button>
                    {selectedManagedAgent ? (
                      <Link
                        href={`/agents/${selectedManagedAgent.id}`}
                        className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Manage agent
                      </Link>
                    ) : null}
                    {selectedManagedBoard ? (
                      <Link
                        href={`/boards/${selectedManagedBoard.id}`}
                        className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Open board
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="max-h-[420px] space-y-3 overflow-y-auto px-5 py-4">
                  {selectedHistory.length === 0 ? (
                    <div className="text-sm text-slate-500">No live history available yet.</div>
                  ) : (
                    selectedHistory.map((message) => (
                      <div
                        key={message.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <MessageSquare className="h-3.5 w-3.5" />
                            {message.role}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatAbsolute(message.timestamp)}
                          </span>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                          {message.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t border-slate-200 px-5 py-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Create handoff task</div>
                        <div className="text-xs text-slate-500">
                          Turn this live session into trackable board work with assignee context.
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <select
                          value={effectiveHandoffBoardId}
                        onChange={(event) => setHandoffBoardId(event.target.value)}
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-300"
                      >
                        <option value="">Select board</option>
                        {boards.map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={effectiveHandoffAgentId}
                        onChange={(event) => setHandoffAgentId(event.target.value)}
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-300"
                      >
                        <option value="">Unassigned</option>
                        {boardAgentOptions.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={effectiveHandoffTitle}
                        onChange={(event) => setHandoffTitle(event.target.value)}
                        placeholder="Task title"
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-300"
                      />
                      <Textarea
                        className="min-h-[96px] bg-white"
                        value={effectiveHandoffDescription}
                        onChange={(event) => setHandoffDescription(event.target.value)}
                        placeholder="Describe the work to continue from this live session..."
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500">
                          Target board and assignee stay inside Mission Control, while the live session remains active.
                        </div>
                        <Button
                          type="button"
                          onClick={() => handoffTaskMutation.mutate()}
                          disabled={
                            handoffTaskMutation.isPending ||
                            !effectiveHandoffBoardId ||
                            !effectiveHandoffTitle.trim()
                          }
                        >
                          {handoffTaskMutation.isPending ? "Creating..." : "Create handoff"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Delegate or steer
                  </label>
                  <Textarea
                    className="mt-2 min-h-[120px]"
                    placeholder="Send an instruction into the live OpenClaw session..."
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                      Message goes to the real session, not a copied shadow agent.
                    </div>
                    <Button
                      type="button"
                      onClick={() => sendMutation.mutate()}
                      disabled={sendMutation.isPending || !draftMessage.trim()}
                    >
                      <SendHorizontal className="h-4 w-4" />
                      {sendMutation.isPending ? "Sending..." : "Send to agent"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-5 py-6 text-sm text-slate-500">
                Select a live session to inspect what the agent is doing.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-sky-50 p-2 text-sky-700">{icon}</div>
        <div className="text-sm font-medium text-slate-600">{title}</div>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}

function formatTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatRelative(value: string | null): string {
  if (!value) return DASH;
  return formatRelativeTimestamp(value);
}

function formatAbsolute(value: string | null): string {
  if (!value) return DASH;
  return formatTimestamp(value);
}
