"use client";

import { customFetch } from "@/api/mutator";
import { extractOpenClawAgentId } from "@/lib/openclaw-session-mapping";

type ApiResponse<T> = {
  data: T;
  headers: Headers;
  status: number;
};

export type GatewayStatusPayload = {
  connected: boolean;
  gateway_url: string;
  sessions_count?: number | null;
  sessions?: unknown[] | null;
  main_session?: unknown | null;
  main_session_error?: string | null;
  error?: string | null;
};

export type GatewayHistoryPayload = {
  history: unknown[];
};

export type SessionSummary = {
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

export type SessionMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: string | null;
};

type AgentBinding = {
  openclaw_session_id?: string | null;
};

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

const parseTimestamp = (value: string): Date | null => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

const buildGatewayQuery = (gatewayId: string): string => {
  const params = new URLSearchParams({ gateway_id: gatewayId });
  return params.toString();
};

export const parseSessionSummary = (value: unknown): SessionSummary | null => {
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
    label: readString(record, ["label", "displayName", "title", "name"]) ?? key,
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

export const parseSessionMessage = (
  value: unknown,
  index: number,
): SessionMessage | null => {
  const record = toRecord(value);
  if (!record) return null;
  const content = readString(record, ["content", "text", "message", "body"]) ?? "";
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
    role: readString(record, ["role", "senderRole", "author", "type"]) ?? "message",
    content,
    timestamp,
  };
};

export async function fetchGatewayStatus(
  gatewayId: string,
): Promise<GatewayStatusPayload> {
  const query = buildGatewayQuery(gatewayId);
  const response = await customFetch<ApiResponse<GatewayStatusPayload>>(
    `/api/v1/gateways/status?${query}`,
    { method: "GET" },
  );
  return response.data;
}

export async function fetchSessionHistory(
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

export async function postSessionMessage(
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

export async function postSessionAction(
  gatewayId: string,
  sessionId: string,
  action: "reset" | "delete",
): Promise<void> {
  const query = buildGatewayQuery(gatewayId);
  const method = action === "delete" ? "DELETE" : "POST";
  const actionPath = action === "delete" ? "" : `/${action}`;
  await customFetch<ApiResponse<{ ok: boolean }>>(
    `/api/v1/gateways/sessions/${encodeURIComponent(sessionId)}${actionPath}?${query}`,
    { method },
  );
}

export const normalizeLiveSessions = (sessions: unknown[] | null | undefined): SessionSummary[] =>
  (sessions ?? [])
    .map(parseSessionSummary)
    .filter((item): item is SessionSummary => item !== null)
    .sort((left, right) => {
      const leftTs = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTs = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTs - leftTs;
    });

export const normalizeSessionHistory = (
  history: unknown[] | null | undefined,
): SessionMessage[] =>
  (history ?? [])
    .map(parseSessionMessage)
    .filter((item): item is SessionMessage => item !== null);

export const sessionMatchesAgent = <TAgent extends AgentBinding>(
  agent: TAgent,
  sessionKey: string | null | undefined,
): boolean => {
  const binding = agent.openclaw_session_id?.trim();
  const normalizedKey = sessionKey?.trim();
  if (!binding || !normalizedKey) return false;
  if (binding === normalizedKey) return true;
  return extractOpenClawAgentId(binding) === extractOpenClawAgentId(normalizedKey);
};

export const findSessionForAgent = <TAgent extends AgentBinding>(
  agent: TAgent | null | undefined,
  sessions: SessionSummary[],
): SessionSummary | null => {
  if (!agent) return null;
  const matches = sessions.filter((session) => sessionMatchesAgent(agent, session.key));
  if (matches.length === 0) return null;
  const running = matches.find((session) => session.status === "running");
  return running ?? matches[0] ?? null;
};

export const buildCommandCenterHref = ({
  gatewayId,
  sessionKey,
  boardId,
  agentId,
}: {
  gatewayId: string;
  sessionKey?: string | null;
  boardId?: string | null;
  agentId?: string | null;
}): string => {
  const params = new URLSearchParams({ gateway: gatewayId });
  if (sessionKey) params.set("session", sessionKey);
  if (boardId) params.set("handoffBoard", boardId);
  if (agentId) params.set("handoffAgent", agentId);
  return `/command-center?${params.toString()}`;
};
