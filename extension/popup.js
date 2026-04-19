import { getConfig } from "./lib/api.js";

const statusEl = document.getElementById("status");
const optionsBtn = document.getElementById("options-btn");
const pulseBtn = document.getElementById("pulse-btn");

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

  optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  pulseBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: `${baseUrl}/leads` });
  });
})();
