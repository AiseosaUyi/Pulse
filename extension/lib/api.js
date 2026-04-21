// Pulse API client for the extension. Storage (token + base URL)
// lives in the background service worker — dynamically-imported
// modules only see `chrome.runtime`, not `chrome.storage`. We route
// every storage call through `chrome.runtime.sendMessage`.

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

async function request(path, { method = "GET", body } = {}) {
  const { baseUrl, token } = await getConfig();
  if (!token) {
    throw new PulseApiError(
      "No Pulse API token set. Open options to paste one.",
      401
    );
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PulseApiError(
      data?.error || `${res.status} ${res.statusText}`,
      res.status
    );
  }
  return data;
}

export class PulseApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PulseApiError";
    this.status = status;
  }
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
