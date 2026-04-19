// Service worker placeholder. MV3 extensions need a registered
// service worker for options_ui + messaging; ours is minimal.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
