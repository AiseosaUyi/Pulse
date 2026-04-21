// Service worker. Owns all chrome.storage access because content
// scripts running dynamically imported ES modules (lib/api.js,
// lib/log.js) only see `chrome.runtime` — `chrome.storage` is
// undefined in that scope. Messages flow one way: modules →
// sendMessage → here → real chrome.storage call → sendResponse.

const DEFAULT_BASE = "https://pulse-ashy-kappa.vercel.app";
const CONFIG_KEYS = ["pulseBaseUrl", "pulseToken"];
const LOG_KEY = "pulseEventLog";
const MAX_LOG_ENTRIES = 30;
const CAPTURED_KEY = "pulseCaptured";
const MAX_CAPTURED_ENTRIES = 500;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

function normalizeBase(raw) {
  return String(raw || DEFAULT_BASE).replace(/\/+$/, "");
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(CONFIG_KEYS);
  return {
    baseUrl: normalizeBase(stored.pulseBaseUrl),
    token: stored.pulseToken || null,
  };
}

async function setConfig(patch) {
  const next = {};
  if (patch.baseUrl !== undefined) next.pulseBaseUrl = patch.baseUrl;
  if (patch.token !== undefined) next.pulseToken = patch.token;
  // Allow explicit clear of the token.
  if (patch.clearToken) {
    await chrome.storage.sync.remove("pulseToken");
  }
  if (Object.keys(next).length > 0) {
    await chrome.storage.sync.set(next);
  }
  return getConfig();
}

async function readLog() {
  const stored = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
}

async function writeLog(entries) {
  await chrome.storage.local.set({ [LOG_KEY]: entries });
}

async function appendLogEntry(entry) {
  const full = {
    ts: Date.now(),
    level: entry?.level ?? "info",
    kind: entry?.kind ?? "event",
    message: String(entry?.message ?? ""),
    context: entry?.context ?? null,
  };
  const current = await readLog();
  const next = [full, ...current].slice(0, MAX_LOG_ENTRIES);
  await writeLog(next);
  return full;
}

async function clearLog() {
  await writeLog([]);
}

// ──────────────────────────────────────────────
// Captured prospects store (local-only staging area)
// Content scripts can't reach chrome.storage.local. Same pattern
// as log storage — all access routes through here via sendMessage.
// ──────────────────────────────────────────────

async function readCaptured() {
  const stored = await chrome.storage.local.get(CAPTURED_KEY);
  return Array.isArray(stored[CAPTURED_KEY]) ? stored[CAPTURED_KEY] : [];
}

async function writeCaptured(entries) {
  await chrome.storage.local.set({ [CAPTURED_KEY]: entries });
}

function dedupKeyFor(entry) {
  return `${entry.platform}:${entry.handle}`;
}

async function appendCaptured(items) {
  // items is an array of {platform, handle, profileUrl, hashtag?,
  // postUrl?, source, sessionId?}. Dedup against existing 'local'
  // entries so repeat captures of the same person on the same
  // hashtag collapse to one row.
  const current = await readCaptured();
  const existingLocal = new Set(
    current
      .filter((c) => c.status === "local")
      .map(dedupKeyFor)
  );
  const now = Date.now();
  let added = 0;
  let skipped = 0;
  const toAdd = [];

  for (const raw of items) {
    const platform = String(raw?.platform ?? "").toLowerCase();
    const handle = String(raw?.handle ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!platform || !handle) {
      skipped += 1;
      continue;
    }
    const key = `${platform}:${handle}`;
    if (existingLocal.has(key)) {
      skipped += 1;
      continue;
    }
    existingLocal.add(key);
    added += 1;
    toAdd.push({
      id: `cap_${now}_${Math.random().toString(36).slice(2, 7)}_${handle}`,
      platform,
      handle,
      profileUrl: raw?.profileUrl ?? null,
      capturedAt: now,
      source: raw?.source ?? "opportunistic",
      hashtag: raw?.hashtag ?? null,
      postUrl: raw?.postUrl ?? null,
      sessionId: raw?.sessionId ?? null,
      status: "local",
      note: null,
    });
  }

  // Prepend the newest so the UI shows them at top; FIFO-prune on overflow.
  let next = [...toAdd, ...current];
  if (next.length > MAX_CAPTURED_ENTRIES) {
    // Keep all local entries, drop oldest uploaded/skipped first.
    const nonLocal = next.filter((e) => e.status !== "local");
    const local = next.filter((e) => e.status === "local");
    nonLocal.sort((a, b) => b.capturedAt - a.capturedAt);
    const keepNonLocal = nonLocal.slice(
      0,
      Math.max(0, MAX_CAPTURED_ENTRIES - local.length)
    );
    next = [...local, ...keepNonLocal];
  }
  await writeCaptured(next);
  return { added, skipped, total: next.length };
}

async function updateCapturedStatus({ ids, status }) {
  if (!Array.isArray(ids) || ids.length === 0) return { updated: 0 };
  const idSet = new Set(ids);
  const current = await readCaptured();
  let updated = 0;
  const next = current.map((e) => {
    if (idSet.has(e.id)) {
      updated += 1;
      return { ...e, status };
    }
    return e;
  });
  await writeCaptured(next);
  return { updated };
}

async function deleteCaptured({ ids }) {
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
  const idSet = new Set(ids);
  const current = await readCaptured();
  const next = current.filter((e) => !idSet.has(e.id));
  await writeCaptured(next);
  return { deleted: current.length - next.length };
}

async function clearCaptured() {
  await writeCaptured([]);
  return { cleared: true };
}

async function capturedStats() {
  const current = await readCaptured();
  const local = current.filter((e) => e.status === "local");
  const uploaded = current.filter((e) => e.status === "uploaded");
  const skipped = current.filter((e) => e.status === "skipped");
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = current.filter(
    (e) => new Date(e.capturedAt).toISOString().slice(0, 10) === todayKey
  );
  return {
    total: current.length,
    local: local.length,
    uploaded: uploaded.length,
    skipped: skipped.length,
    today: today.length,
  };
}

/**
 * Cross-origin fetch proxy. MV3 content scripts can't bypass CORS
 * (Chrome 73+), so every API call from lib/api.js is forwarded
 * here. The service worker has full host_permissions reach and
 * doesn't inherit the page's CORS rules.
 *
 * Takes a relative `path` (e.g. "/api/ext/prospect"), not a full
 * URL — the worker prepends the tenant's base URL from config
 * and adds the bearer token. That keeps the token out of the
 * content script entirely.
 */
async function apiCall(msg) {
  const { baseUrl, token } = await getConfig();
  if (!token) {
    return { ok: false, status: 401, error: "No Pulse API token set" };
  }
  const path = String(msg.path ?? "");
  const method = String(msg.method ?? "GET").toUpperCase();
  const body = msg.body ?? null;

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data: parsed,
      error: res.ok ? null : parsed?.error ?? `${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err),
    };
  }
}

// Single onMessage router. Every handler returns a Promise; we
// wrap it below in a sendResponse dispatcher that keeps the
// message channel open with `return true`.
const HANDLERS = {
  "config.get": () => getConfig(),
  "config.set": (msg) => setConfig(msg.patch ?? {}),
  "log.read": () => readLog(),
  "log.write": (msg) => writeLog(msg.entries ?? []),
  "log.append": (msg) => appendLogEntry(msg.entry ?? {}),
  "log.clear": () => clearLog(),
  "api.call": (msg) => apiCall(msg),
  "captured.list": () => readCaptured(),
  "captured.append": (msg) => appendCaptured(msg.items ?? []),
  "captured.update-status": (msg) =>
    updateCapturedStatus({ ids: msg.ids ?? [], status: msg.status ?? "local" }),
  "captured.delete": (msg) => deleteCaptured({ ids: msg.ids ?? [] }),
  "captured.clear": () => clearCaptured(),
  "captured.stats": () => capturedStats(),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.kind !== "string") {
    sendResponse({ ok: false, error: "missing kind" });
    return false;
  }
  const handler = HANDLERS[msg.kind];
  if (!handler) {
    sendResponse({ ok: false, error: `unknown kind: ${msg.kind}` });
    return false;
  }
  Promise.resolve()
    .then(() => handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      sendResponse({
        ok: false,
        error:
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err),
      });
    });
  return true; // keep channel open for async response
});
