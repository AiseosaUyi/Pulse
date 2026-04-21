import { capturedStats, getConfig } from "./lib/api.js";

const statusEl = document.getElementById("status");
const optionsBtn = document.getElementById("options-btn");
const pulseBtn = document.getElementById("pulse-btn");
const capturedBtn = document.getElementById("captured-btn");

(async () => {
  const { baseUrl, token } = await getConfig();

  if (!token) {
    statusEl.innerHTML =
      '<p><strong style="color:#b91c1c">Not connected.</strong> Paste a Pulse API token in options to start drafting.</p>';
  } else {
    statusEl.innerHTML = `
      <p><strong style="color:#15803d">Connected</strong> to ${baseUrl}</p>
      <p>Token ending in <code>${token.slice(-4)}</code></p>
    `;
  }

  // Counts for the captured-prospects button.
  try {
    const stats = await capturedStats();
    const localCount = stats?.local ?? 0;
    if (localCount > 0) {
      capturedBtn.innerHTML = `Captured prospects <span class="count">${localCount}</span>`;
    }
  } catch {
    // ignore — button works without count
  }

  optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  pulseBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: `${baseUrl}/leads` });
  });

  capturedBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("captured.html") });
  });
})();
