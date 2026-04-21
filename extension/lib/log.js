// In-extension event log. Lightweight, persistent (chrome.storage.local)
// so Priye can see what happened even after she reloads the page.
// Ring buffer of the last 30 entries — enough to debug a session
// without bloating storage.

const STORAGE_KEY = "pulseEventLog";
const MAX_ENTRIES = 30;

export async function readLog() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  } catch {
    return [];
  }
}

export async function writeLog(entries) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: entries });
  } catch {
    // chrome.storage can fail in incognito — swallow.
  }
}

export async function appendEvent(entry) {
  const full = {
    ts: Date.now(),
    level: entry.level ?? "info", // 'info' | 'success' | 'warn' | 'error'
    kind: entry.kind ?? "event", // free-form — 'save', 'lookup', 'draft', 'copy-primary', etc.
    message: String(entry.message ?? ""),
    context: entry.context ?? null, // optional: { platform, handle, url, ... }
  };
  const current = await readLog();
  const next = [full, ...current].slice(0, MAX_ENTRIES);
  await writeLog(next);
  return full;
}

export async function clearLog() {
  await writeLog([]);
}

/**
 * Wrap an async operation so its success/failure is logged
 * automatically. Returns the underlying result, re-throws on error
 * after logging. Use in call sites where you want the log to own
 * the telemetry without changing business logic.
 */
export async function withLogging(kind, context, fn) {
  try {
    const result = await fn();
    await appendEvent({
      level: "success",
      kind,
      message: "ok",
      context,
    });
    return result;
  } catch (err) {
    await appendEvent({
      level: "error",
      kind,
      message:
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err),
      context: {
        ...context,
        status: err && typeof err === "object" && "status" in err ? err.status : undefined,
      },
    });
    throw err;
  }
}
