// Event-platform lead capture — SEPARATE from content.js (IG/TikTok/X/
// LinkedIn profile capture). Runs only on Clooza, Tickethub.ng,
// app.eventpadi.com, EventPorte, Tixvnt, Selar: platforms confirmed
// (2026-07-08) to have real event/organizer data that only a real browser
// can see. One click captures whatever the page shows; the human doing
// the browsing is what makes this work where automated scraping can't.

(async () => {
  const detectModule = await import(chrome.runtime.getURL("lib/detect-events.js"));
  const apiModule = await import(chrome.runtime.getURL("lib/api.js"));
  const logModule = await import(chrome.runtime.getURL("lib/log.js"));
  const { detectEventPlatform, scrapeEventPageMeta } = detectModule;
  const { upsertEventLead, PulseApiError } = apiModule;
  const { appendEvent } = logModule;

  let fab = null;
  let lastUrl = location.href;

  function currentTarget() {
    return detectEventPlatform(location.href);
  }

  function ensureFab(target) {
    if (!target) {
      if (fab) {
        fab.remove();
        fab = null;
      }
      return;
    }
    if (fab) return;

    fab = document.createElement("div");
    fab.className = "pulse-ext-fab-group";

    const btn = document.createElement("button");
    btn.className = "pulse-ext-fab";
    btn.type = "button";
    btn.title = `Capture this ${target.label} lead into Pulse. Highlight the organizer's name on the page first if you want to override the auto-detected one.`;
    btn.innerHTML = `
      <span class="pulse-ext-fab__logo">◐</span>
      <span class="pulse-ext-fab__label">Capture event lead</span>
    `;
    btn.addEventListener("click", () => handleCapture(target));
    fab.appendChild(btn);
    document.body.appendChild(fab);
  }

  function setFabLabel(text) {
    const label = fab?.querySelector(".pulse-ext-fab__label");
    if (label) label.textContent = text;
  }

  async function handleCapture(target) {
    setFabLabel("Capturing…");
    const meta = scrapeEventPageMeta(target);
    try {
      const { prospect } = await upsertEventLead({
        platformId: target.platformId,
        pageUrl: meta.pageUrl,
        eventTitle: meta.eventTitle,
        organizerName: meta.organizerName,
        organizerHandle: meta.organizerHandle,
        priceRaw: meta.priceRaw,
        socialUrl: meta.socialUrl,
      });
      setFabLabel(prospect ? "✓ Captured" : "✓ Saved");
      await appendEvent({
        level: "success",
        kind: "event-lead-capture",
        message: `captured ${target.platformId}${prospect?.handle ? ` · @${prospect.handle}` : ""}`,
        context: {
          platformId: target.platformId,
          url: meta.pageUrl,
          organizerName: meta.organizerName,
          resolvedHandle: prospect?.handle,
        },
      });
    } catch (err) {
      const msg =
        err instanceof PulseApiError
          ? err.status === 401
            ? "Token missing"
            : err.message
          : "Capture failed";
      setFabLabel(msg);
      await appendEvent({
        level: "error",
        kind: "event-lead-capture",
        message:
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err),
        context: { platformId: target.platformId, url: meta.pageUrl },
      });
    }
    setTimeout(() => {
      if (fab) setFabLabel("Capture event lead");
    }, 2400);
  }

  function syncToCurrentPage() {
    ensureFab(currentTarget());
  }

  syncToCurrentPage();

  // Event platforms are mostly client-rendered SPAs — the FAB needs to
  // react to in-app navigation (URL change without a full page load),
  // same MutationObserver + popstate pattern as content.js.
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncToCurrentPage();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", syncToCurrentPage);
})();
