import { describe, expect, it } from "vitest";

import {
  buildCommandCenterHref,
  findSessionForAgent,
  normalizeLiveSessions,
  parseSessionMessage,
  sessionMatchesAgent,
} from "@/lib/openclaw-live";

describe("openclaw-live", () => {
  it("normalizes and sorts live sessions by freshest update", () => {
    const sessions = normalizeLiveSessions([
      { key: "agent:writer", updatedAt: "2026-04-08T10:00:00Z", status: "idle" },
      { key: "agent:main", updatedAt: "2026-04-08T11:00:00Z", status: "running" },
    ]);

    expect(sessions.map((session) => session.key)).toEqual([
      "agent:main",
      "agent:writer",
    ]);
  });

  it("matches imported agents to nested live session keys", () => {
    const agent = { openclaw_session_id: "agent:main" };

    expect(sessionMatchesAgent(agent, "agent:main:telegram:direct:123")).toBe(true);
    expect(sessionMatchesAgent(agent, "agent:writer")).toBe(false);
  });

  it("prefers running sessions when multiple live sessions map to one agent", () => {
    const agent = { openclaw_session_id: "agent:main" };
    const match = findSessionForAgent(agent, [
      {
        key: "agent:main:telegram:123",
        label: "idle",
        status: "idle",
        updatedAt: "2026-04-08T10:00:00Z",
        startedAt: null,
        channel: null,
        model: null,
        totalTokens: null,
        estimatedCostUsd: null,
        childSessionCount: 0,
        raw: {},
      },
      {
        key: "agent:main:subagent:456",
        label: "running",
        status: "running",
        updatedAt: "2026-04-08T11:00:00Z",
        startedAt: null,
        channel: null,
        model: null,
        totalTokens: null,
        estimatedCostUsd: null,
        childSessionCount: 0,
        raw: {},
      },
    ]);

    expect(match?.key).toBe("agent:main:subagent:456");
  });

  it("parses session messages from variant payload keys", () => {
    const message = parseSessionMessage(
      { messageId: "m1", senderRole: "assistant", body: "working", ts: 1_744_110_400 },
      0,
    );

    expect(message).toMatchObject({
      id: "m1",
      role: "assistant",
      content: "working",
    });
  });

  it("builds command center deep links with handoff context", () => {
    expect(
      buildCommandCenterHref({
        gatewayId: "gw-1",
        sessionKey: "agent:main:telegram:123",
        boardId: "board-1",
        agentId: "agent-1",
      }),
    ).toBe(
      "/command-center?gateway=gw-1&session=agent%3Amain%3Atelegram%3A123&handoffBoard=board-1&handoffAgent=agent-1",
    );
  });
});
