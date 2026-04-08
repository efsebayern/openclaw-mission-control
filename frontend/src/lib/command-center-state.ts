const PINNED_SESSIONS_KEY = "mc_command_center_pinned_sessions";

export const readPinnedSessionKeys = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
};

export const writePinnedSessionKeys = (sessionKeys: string[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(sessionKeys));
  } catch {
    // Ignore storage failures.
  }
};
