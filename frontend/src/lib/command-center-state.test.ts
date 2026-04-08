import { afterEach, describe, expect, it } from "vitest";

import { readPinnedSessionKeys, writePinnedSessionKeys } from "./command-center-state";

const storage: Record<string, string> = {};

Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      Object.keys(storage).forEach((key) => {
        delete storage[key];
      });
    },
  },
  configurable: true,
});

describe("command-center-state", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("persists pinned session keys", () => {
    writePinnedSessionKeys(["agent:main:main", "agent:vibe-writer:cron:test"]);
    expect(readPinnedSessionKeys()).toEqual([
      "agent:main:main",
      "agent:vibe-writer:cron:test",
    ]);
  });

  it("ignores malformed storage payloads", () => {
    window.localStorage.setItem("mc_command_center_pinned_sessions", "{\"bad\":true}");
    expect(readPinnedSessionKeys()).toEqual([]);
  });
});
