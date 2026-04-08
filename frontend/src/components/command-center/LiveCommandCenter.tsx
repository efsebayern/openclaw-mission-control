"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
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
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import { formatRelativeTimestamp, formatTimestamp, parseTimestamp } from "@/lib/formatters";
import { buildAgentLookup, resolveManagedAgent } from "@/lib/openclaw-session-mapping";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ApiResponse<T> = {
  data: T;
  headers: Headers;
  status: number;
};

type GatewayStatusPayload = {
  connected: boolean;
  gateway_url: string;
  sessions_count?: number | null;
  sessions?: unknown[] | null;
  main_session?: unknown | null;
  main_session_error?: string | null;
  error?: string | null;
};

type GatewayHistoryPayload = {
  history: unknown[];
};

type SessionSummary = {
  key: string;
  label: string;
  status: string;
  updatedAt: string | null;
  startedAt: string | null;
  channel: string | null;
  model: string | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  childSessionCount: number;
  raw: Record<string, unknown>;
};

type SessionMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: string | null;
};

const DASH = "—";

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

const readString = (
  record: Record<string, unknown> | null,
  keys: string[],
): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const readNumber = (
  record: Record<string, unknown> | null,
  keys: string[],
): number | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const normalizeEpochMs = (value: number): number => {
  if (value >= 1_000_000_000_000) return value;
  if (value >= 1_000_000_000) return value * 1000;
  return value;
};

const readTimestamp = (
  record: Record<string, unknown> | null,
  keys: string[],
): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(normalizeEpochMs(value));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof value === "string") {
      const parsed = parseTimestamp(value);
      if (parsed) return parsed.toISOString();
      const numeric = Number.parseFloat(value);
      if (Number.isFinite(numeric)) {
        const date = new Date(normalizeEpochMs(numeric));
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
    }
  }
  return null;
};

const formatMoney = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return DASH;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const buildGatewayQuery = (gatewayId: string): string => {
  const params = new URLSearchParams({ gateway_id: gatewayId });
  return params.toString();
};

const parseSessionSummary = (value: unknown): SessionSummary | null => {
  const record = toRecord(value);
  const key = readString(record, ["key", "sessionKey", "id", "sessionId"]);
  if (!key) return null;

  const childSessions = record?.childSessions;
  const childSessionCount = Array.isArray(childSessions) ? childSessions.length : 0;
  const modelName = readString(record, ["model"]);
  const modelProvider = readString(record, ["modelProvider"]);
  const combinedModel = [modelProvider, modelName].filter(Boolean).join(" ").trim();

  return {
    key,
    label:
      readString(record, ["label", "displayName", "title", "name"]) ?? key,
    status: readString(record, ["status", "state"]) ?? "unknown",
    updatedAt: readTimestamp(record, ["updatedAt", "updated_at", "lastSeenAt"]),
    startedAt: readTimestamp(record, ["startedAt", "started_at"]),
    channel: readString(record, ["channel", "lastChannel", "chatType"]),
    model: modelName ?? (combinedModel || null),
    totalTokens: readNumber(record, ["totalTokens", "total_tokens"]),
    estimatedCostUsd: readNumber(record, ["estimatedCostUsd", "estimated_cost_usd"]),
    childSessionCount,
    raw: record ?? {},
  };
};

const parseSessionMessage = (value: unknown, index: number): SessionMessage | null => {
  const record = toRecord(value);
  if (!record) return null;
  const content =
    readString(record, ["content", "text", "message", "body"]) ?? "";
  if (!content) return null;
  const timestamp = readTimestamp(record, [
    "createdAt",
    "created_at",
    "timestamp",
    "ts",
    "updatedAt",
  ]);
  return {
    id: readString(record, ["id", "messageId"]) ?? `${index}:${timestamp ?? "msg"}`,
    role:
      readString(record, ["role", "senderRole", "author", "type"]) ?? "message",
    content,
    timestamp,
  };
};

async function fetchGatewayStatus(gatewayId: string): Promise<GatewayStatusPayload> {
  const query = buildGatewayQuery(gatewayId);
  const response = await customFetch<ApiResponse<GatewayStatusPayload>>(
    `/api/v1/gateways/status?${query}`,
    { method: "GET" },
  );
  return response.data;
}

async function fetchSessionHistory(
  gatewayId: string,
  sessionId: string,
): Promise<GatewayHistoryPayload> {
  const query = buildGatewayQuery(gatewayId);
  const response = await customFetch<ApiResponse<GatewayHistoryPayload>>(
    `/api/v1/gateways/sessions/${encodeURIComponent(sessionId)}/history?${query}`,
    { method: "GET" },
  );
  return response.data;
}

async function postSessionMessage(
  gatewayId: string,
  sessionId: string,
  content: string,
): Promise<void> {
  const query = buildGatewayQuery(gatewayId);
  await customFetch<ApiResponse<{ ok: boolean }>>(
    `/api/v1/gateways/sessions/${encodeURIComponent(sessionId)}/message?${query}`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
}

export function LiveCommandCenter() {
  const { isSignedIn } = useAuth();
  const { isAdmin } = useOrganizationMembership(isSignedIn);
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");

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
      : (gateways[0]?.id ?? null);

  const selectedGateway =
    gateways.find((gateway) => gateway.id === effectiveSelectedGatewayId) ?? null;

  const selectedGatewayStatus = effectiveSelectedGatewayId
    ? gatewayStatusById.get(effectiveSelectedGatewayId) ?? null
    : null;

  const liveSessions = useMemo(() => {
    const records = selectedGatewayStatus?.sessions ?? [];
    return records
      .map(parseSessionSummary)
      .filter((item): item is SessionSummary => item !== null)
      .sort((left, right) => {
        const leftTs = left.updatedAt ? Date.parse(left.updatedAt) : 0;
        const rightTs = right.updatedAt ? Date.parse(right.updatedAt) : 0;
        return rightTs - leftTs;
      });
  }, [selectedGatewayStatus]);

  const effectiveSelectedSessionKey =
    selectedSessionKey &&
    liveSessions.some((session) => session.key === selectedSessionKey)
      ? selectedSessionKey
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
    const payload = sessionHistoryQuery.data?.history ?? [];
    return payload
      .map(parseSessionMessage)
      .filter((item): item is SessionMessage => item !== null);
  }, [sessionHistoryQuery.data]);

  const boardById = useMemo(
    () => new Map(boards.map((board) => [board.id, board] as const)),
    [boards],
  );

  const agentLookup = useMemo(() => buildAgentLookup(agents), [agents]);

  const sessionRows = useMemo(
    () =>
      liveSessions.map((session) => {
        const agent = resolveManagedAgent(session.key, agentLookup);
        const board = agent?.board_id ? (boardById.get(agent.board_id) ?? null) : null;
        return { session, agent, board };
      }),
    [agentLookup, boardById, liveSessions],
  );

  const liveStats = useMemo(() => {
    const allSessions = gatewayStatusQueries.flatMap((query) =>
      (query.data?.sessions ?? []).map(parseSessionSummary).filter(Boolean),
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
            </div>
            <div className="max-h-[760px] overflow-y-auto">
              {selectedGatewayStatus?.error ? (
                <div className="p-5 text-sm text-rose-600">{selectedGatewayStatus.error}</div>
              ) : sessionRows.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No live sessions found.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sessionRows.map(({ session, agent, board }) => {
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
                  {selectedSession ? (() => {
                    const mappedAgent = resolveManagedAgent(selectedSession.key, agentLookup);
                    const mappedBoard =
                      mappedAgent?.board_id ? (boardById.get(mappedAgent.board_id) ?? null) : null;
                    if (!mappedAgent) return null;
                    return (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/agents/${mappedAgent.id}`}
                          className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Manage agent
                        </Link>
                        {mappedBoard ? (
                          <Link
                            href={`/boards/${mappedBoard.id}`}
                            className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open board
                          </Link>
                        ) : null}
                      </div>
                    );
                  })() : null}
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
