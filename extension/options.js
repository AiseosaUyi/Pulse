import { getConfig, setConfig, fetchOutboundFilters } from "./lib/api.js";

const baseUrlEl = document.getElementById("baseUrl");
const tokenEl = document.getElementById("token");
const savedEl = document.getElementById("saved");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const passiveDisabledEl = document.getElementById("passive-disabled");
const openFiltersEl = document.getElementById("open-filters");
const filterSummaryEl = document.getElementById("filter-summary");

async function readPassiveDisabled() {
  return new Promise((resolve) => {
    try {
      chrome.storage?.sync?.get?.("pulsePassiveDisabled", (stored) => {
        resolve(stored?.pulsePassiveDisabled === true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function writePassiveDisabled(disabled) {
  return new Promise((resolve) => {
    try {
      chrome.storage?.sync?.set?.(
        { pulsePassiveDisabled: !!disabled },
        () => resolve()
      );
    } catch {
      resolve();
    }
  });
}

function summarizeFilters(filters) {
  if (!filters) return "No filter set loaded yet. Save your token above, then reopen this page.";
  const parts = [];
  parts.push(`${filters.keywords?.length ?? 0} keyword${filters.keywords?.length === 1 ? "" : "s"}`);
  const geoCountries = Array.isArray(filters.geoScope)
    ? filters.geoScope.length
    : 0;
  parts.push(`${geoCountries} countr${geoCountries === 1 ? "y" : "ies"} scoped`);
  parts.push(`${filters.competitorUrls?.length ?? 0} competitor URL${filters.competitorUrls?.length === 1 ? "" : "s"}`);
  if (filters.passiveCaptureEnabled === false) {
    parts.push("⚠ passive OFF tenant-wide");
  }
  parts.push(`dwell ${filters.dwellMs ?? 1200}ms`);
  return parts.join(" · ");
}

async function refreshFilterSummary({ force = false } = {}) {
  filterSummaryEl.textContent = "Loading filters…";
  try {
    const reply = await fetchOutboundFilters({ force });
    const src = reply?.source ?? "cache";
    filterSummaryEl.textContent = `${summarizeFilters(reply?.filters)}  (source: ${src})`;
  } catch (err) {
    filterSummaryEl.textContent = `Couldn't load filters: ${err?.message ?? err}`;
  }
}

(async () => {
  const { baseUrl, token } = await getConfig();
  baseUrlEl.value = baseUrl;
  if (token) tokenEl.placeholder = `Saved (…${token.slice(-4)})`;

  passiveDisabledEl.checked = await readPassiveDisabled();
  passiveDisabledEl.addEventListener("change", async () => {
    await writePassiveDisabled(passiveDisabledEl.checked);
    savedEl.style.display = "block";
    savedEl.textContent = passiveDisabledEl.checked
      ? "Passive capture disabled on this device."
      : "Passive capture re-enabled on this device.";
    setTimeout(() => {
      savedEl.style.display = "none";
      savedEl.textContent = "Saved.";
    }, 1500);
  });

  openFiltersEl.href = `${baseUrl}/settings/outbound-filters`;
  refreshFilterSummary();

  saveBtn.addEventListener("click", async () => {
    const base = baseUrlEl.value.trim();
    const tok = tokenEl.value.trim();
    const patch = {};
    if (base) patch.baseUrl = base;
    if (tok) patch.token = tok;
    if (Object.keys(patch).length === 0) return;
    await setConfig(patch);
    savedEl.style.display = "block";
    tokenEl.value = "";
    if (tok) tokenEl.placeholder = `Saved (…${tok.slice(-4)})`;
    if (base) openFiltersEl.href = `${base}/settings/outbound-filters`;
    // Re-pull filters now that baseUrl/token may have changed.
    refreshFilterSummary({ force: true });
    setTimeout(() => {
      savedEl.style.display = "none";
    }, 1500);
  });

  clearBtn.addEventListener("click", async () => {
    await setConfig({ clearToken: true });
    tokenEl.placeholder = "pulse_ext_…";
    tokenEl.value = "";
    savedEl.textContent = "Disconnected.";
    savedEl.style.display = "block";
    filterSummaryEl.textContent = "Disconnected — filters unavailable.";
    setTimeout(() => {
      savedEl.style.display = "none";
      savedEl.textContent = "Saved.";
    }, 1500);
  });
})();
