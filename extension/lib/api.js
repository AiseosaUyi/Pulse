// Pulse API client for the extension. All requests go through the
// tenant API token stored in chrome.storage.sync.

const DEFAULT_BASE = "https://pulse-ashy-kappa.vercel.app";

export async function getConfig() {
  const { pulseBaseUrl, pulseToken } = await chrome.storage.sync.get([
    "pulseBaseUrl",
    "pulseToken",
  ]);
  return {
    baseUrl: (pulseBaseUrl || DEFAULT_BASE).replace(/\/+$/, ""),
    token: pulseToken || null,
  };
}

export async function setConfig({ baseUrl, token }) {
  const patch = {};
  if (baseUrl !== undefined) patch.pulseBaseUrl = baseUrl;
  if (token !== undefined) patch.pulseToken = token;
  await chrome.storage.sync.set(patch);
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
