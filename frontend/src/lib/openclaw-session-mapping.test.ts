import { describe, expect, it } from "vitest";

import {
  buildAgentLookup,
  extractOpenClawAgentId,
  resolveManagedAgent,
} from "./openclaw-session-mapping";

type TestAgent = {
  id: string;
  name: string;
  openclaw_session_id?: string | null;
};

describe("openclaw-session-mapping", () => {
  it("extracts the agent id from live OpenClaw session keys", () => {
    expect(extractOpenClawAgentId("agent:main:telegram:direct:295267257")).toBe("main");
    expect(extractOpenClawAgentId("agent:mc-gateway-123:main")).toBe("mc-gateway-123");
    expect(extractOpenClawAgentId("vibe-writer")).toBe("vibe-writer");
  });

  it("resolves imported agents from derived live session keys", () => {
    const vibeWriter: TestAgent = {
      id: "a1",
      name: "Vibe Writer",
      openclaw_session_id: "vibe-writer",
    };
    const main: TestAgent = {
      id: "a2",
      name: "main",
      openclaw_session_id: "main",
    };
    const gatewayMain: TestAgent = {
      id: "a3",
      name: "Gateway Agent",
      openclaw_session_id: "mc-gateway-123",
    };

    const lookup = buildAgentLookup([vibeWriter, main, gatewayMain]);

    expect(resolveManagedAgent("agent:vibe-writer:cron:nightly", lookup)).toBe(vibeWriter);
    expect(resolveManagedAgent("agent:main:telegram:direct:295267257", lookup)).toBe(main);
    expect(resolveManagedAgent("agent:mc-gateway-123:main", lookup)).toBe(gatewayMain);
  });

  it("prefers exact session-key bindings when they exist", () => {
    const exact: TestAgent = {
      id: "a1",
      name: "Exact",
      openclaw_session_id: "agent:main:main",
    };
    const derived: TestAgent = {
      id: "a2",
      name: "Derived",
      openclaw_session_id: "main",
    };

    const lookup = buildAgentLookup([exact, derived]);

    expect(resolveManagedAgent("agent:main:main", lookup)).toBe(exact);
  });

  it("returns null for unrelated sessions", () => {
    const lookup = buildAgentLookup<TestAgent>([
      { id: "a1", name: "Vibe Writer", openclaw_session_id: "vibe-writer" },
    ]);

    expect(resolveManagedAgent("agent:unknown:telegram:direct:1", lookup)).toBeNull();
    expect(resolveManagedAgent(null, lookup)).toBeNull();
  });
});
