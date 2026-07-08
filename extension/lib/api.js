// Pulse API client for the extension. Two layers of indirection
// through the background service worker:
//
//   1. Storage (token + base URL) — content scripts' imported
//      modules can't reach chrome.storage. Background owns it.
//   2. fetch() — MV3 content scripts can't bypass CORS (Chrome 73+).
//      Background has host_permissions and runs in its own origin.
//
// So the content script never talks directly to the Pulse backend —
// it sendMessages the background, which does the fetch. This is the
// Chrome-recommended pattern for cross-origin calls from content
// scripts and avoids every CORS / mixed-content edge case.

async function sendBackground(kind, payload = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ kind, ...payload }, (reply) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!reply || reply.ok !== true) {
          reject(new Error(reply?.error ?? "background error"));
          return;
        }
        resolve(reply.data);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function getConfig() {
  return sendBackground("config.get");
}

export async function setConfig(patch) {
  return sendBackground("config.set", { patch });
}

export class PulseApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PulseApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  // api.call is handled in background.js — it reads config, does
  // the fetch from the worker's origin (CORS-free), and returns a
  // normalized envelope.
  const reply = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { kind: "api.call", path, method, body },
        (r) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(r);
        }
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  if (!reply || reply.ok !== true) {
    // Two flavors of failure:
    //   - reply.ok=false with .data = the fetch happened but the
    //     Pulse API returned non-2xx. Bubble the API error message.
    //   - !reply.ok (outer) = the background router itself failed.
    const bg = reply?.data;
    const status = bg?.status ?? reply?.data?.status ?? 0;
    const message =
      bg?.error ?? reply?.error ?? "background call failed";
    throw new PulseApiError(message, status);
  }

  // reply.data is the envelope { ok, status, data, error }.
  const envelope = reply.data;
  if (!envelope.ok) {
    throw new PulseApiError(
      envelope.error ?? `${envelope.status} error`,
      envelope.status
    );
  }
  return envelope.data;
}

export async function lookupProspect({ platform, handle }) {
  const params = new URLSearchParams({ platform, handle });
  return request(`/api/ext/prospect?${params.toString()}`);
}

export async function upsertProspect(input) {
  return request("/api/ext/prospect", { method: "POST", body: input });
}

export async function draftDm(input) {
  return request("/api/ext/draft-dm", { method: "POST", body: input });
}

export async function fetchPrimaryTemplate(platform) {
  const params = new URLSearchParams({ platform });
  return request(`/api/ext/primary-template?${params.toString()}`);
}

export async function markDmSent(dmId) {
  return request(`/api/ext/dm/${encodeURIComponent(dmId)}/sent`, {
    method: "POST",
  });
}

export async function bulkUploadProspects(items) {
  return request("/api/ext/prospects/bulk", {
    method: "POST",
    body: { items },
  });
}

// Event-platform capture (Clooza/Tickethub.ng/Eventpadi/EventPorte/Tixvnt)
// — separate endpoint from upsertProspect, see event-content.js.
export async function upsertEventLead(input) {
  return request("/api/ext/event-lead", { method: "POST", body: input });
}

// ──────────────────────────────────────────────
// Captured-store facade — proxied through background
// (content scripts can't reach chrome.storage.local directly).
// ──────────────────────────────────────────────

export async function capturedList() {
  return sendBackground("captured.list");
}

export async function capturedAppend(items) {
  return sendBackground("captured.append", { items });
}

export async function capturedUpdateStatus(ids, status) {
  return sendBackground("captured.update-status", { ids, status });
}

export async function capturedDelete(ids) {
  return sendBackground("captured.delete", { ids });
}

export async function capturedClear() {
  return sendBackground("captured.clear");
}

export async function capturedStats() {
  return sendBackground("captured.stats");
}

// ──────────────────────────────────────────────
// Outbound filters facade — keywords/geo/competitors/passive toggle
// pulled from Pulse and cached in chrome.storage.local by background.
// Content scripts call this to drive local pre-scoring without a
// network hit per capture.
// ──────────────────────────────────────────────

export async function fetchOutboundFilters({ force = false } = {}) {
  return sendBackground("filters.get", { force });
}
