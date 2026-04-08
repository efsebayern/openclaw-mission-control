type AgentBinding = {
  openclaw_session_id?: string | null;
};

type AgentLookup<TAgent> = {
  exact: Map<string, TAgent>;
  byOpenClawAgentId: Map<string, TAgent>;
};

const normalizeBinding = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const extractOpenClawAgentId = (sessionKey: string | null | undefined): string | null => {
  const normalized = normalizeBinding(sessionKey);
  if (!normalized) return null;
  if (!normalized.startsWith("agent:")) return normalized;

  const parts = normalized.split(":");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
};

export const buildAgentLookup = <TAgent extends AgentBinding>(
  agents: TAgent[],
): AgentLookup<TAgent> => {
  const exact = new Map<string, TAgent>();
  const byOpenClawAgentId = new Map<string, TAgent>();

  for (const agent of agents) {
    const binding = normalizeBinding(agent.openclaw_session_id);
    if (!binding) continue;

    exact.set(binding, agent);

    const agentId = extractOpenClawAgentId(binding);
    if (agentId && !byOpenClawAgentId.has(agentId)) {
      byOpenClawAgentId.set(agentId, agent);
    }
  }

  return { exact, byOpenClawAgentId };
};

export const resolveManagedAgent = <TAgent extends AgentBinding>(
  sessionKey: string | null | undefined,
  lookup: AgentLookup<TAgent>,
): TAgent | null => {
  const normalized = normalizeBinding(sessionKey);
  if (!normalized) return null;

  const exactMatch = lookup.exact.get(normalized);
  if (exactMatch) return exactMatch;

  const agentId = extractOpenClawAgentId(normalized);
  if (!agentId) return null;

  return lookup.byOpenClawAgentId.get(agentId) ?? null;
};
