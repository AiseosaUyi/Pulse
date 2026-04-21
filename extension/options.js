import { getConfig, setConfig } from "./lib/api.js";

const baseUrlEl = document.getElementById("baseUrl");
const tokenEl = document.getElementById("token");
const savedEl = document.getElementById("saved");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");

(async () => {
  const { baseUrl, token } = await getConfig();
  baseUrlEl.value = baseUrl;
  if (token) tokenEl.placeholder = `Saved (…${token.slice(-4)})`;

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
    setTimeout(() => {
      savedEl.style.display = "none";
    }, 1500);
  });

  clearBtn.addEventListener("click", async () => {
    // Route through the background worker so this works identically
    // regardless of whether chrome.storage is reachable directly.
    await setConfig({ clearToken: true });
    tokenEl.placeholder = "pulse_ext_…";
    tokenEl.value = "";
    savedEl.textContent = "Disconnected.";
    savedEl.style.display = "block";
    setTimeout(() => {
      savedEl.style.display = "none";
      savedEl.textContent = "Saved.";
    }, 1500);
  });
})();
