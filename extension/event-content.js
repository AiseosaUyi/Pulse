// Event-platform lead capture — SEPARATE from content.js (IG/TikTok/X/
// LinkedIn profile capture). Runs only on Clooza, Tickethub.ng,
// app.eventpadi.com, EventPorte, Tixvnt: platforms confirmed (2026-07-08)
// to have real event/organizer data that only a real browser can see.
// One click captures whatever the page shows; the human doing the
// browsing is what makes this work where automated scraping can't.
// (Selar and Ariiya Tickets were researched and ruled out — no public
// directory on Selar, Ariiya's event pages 404 site-wide.)

(async () => {
  const detectModule = await import(chrome.runtime.getURL("lib/detect-events.js"));
  const apiModule = await import(chrome.runtime.getURL("lib/api.js"));
  const logModule = await import(chrome.runtime.getURL("lib/log.js"));
  const { detectEventPlatform, scrapeEventPageMeta, scrapeEventpadiListing } = detectModule;
  const { upsertEventLead, PulseApiError } = apiModule;
  const { appendEvent } = logModule;

  let fab = null;
  let fabKind = null;
  let lastUrl = location.href;

  function currentTarget() {
    return detectEventPlatform(location.href);
  }

  function kindOf(target) {
    if (!target) return null;
    if (target.loggedOut) return "loggedOut";
    if (target.pageType === "listing") return "listing";
    return "default";
  }

  function ensureFab(target) {
    const kind = kindOf(target);
    if (!kind) {
      if (fab) {
        fab.remove();
        fab = null;
        fabKind = null;
      }
      return;
    }
    if (fab && fabKind === kind) return;
    if (fab) {
      fab.remove();
      fab = null;
    }
    fabKind = kind;

    fab = document.createElement("div");
    fab.className = "pulse-ext-fab-group";

    if (kind === "loggedOut") {
      const notice = document.createElement("div");
      notice.className = "pulse-ext-fab";
      notice.textContent = `Log in to ${target.label} to capture leads`;
      fab.appendChild(notice);
    } else if (kind === "listing") {
      const btn = document.createElement("button");
      btn.className = "pulse-ext-fab";
      btn.type = "button";
      btn.title = `Scan every event card visible on this ${target.label} listing page and save each organizer as a Pulse lead.`;
      btn.innerHTML = `
        <span class="pulse-ext-fab__logo">◐</span>
        <span class="pulse-ext-fab__label">Capture visible events</span>
      `;
      btn.addEventListener("click", () => handleBulkCapture(target));
      fab.appendChild(btn);
    } else {
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
    }
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

  // Eventpadi has no per-event page — one click walks every card
  // currently rendered on the discover listing and upserts each
  // organizer as a lead, reusing the same /api/ext/event-lead endpoint
  // one row at a time (no bulk backend route needed).
  async function handleBulkCapture(target) {
    const cards = scrapeEventpadiListing();
    if (!cards.length) {
      setFabLabel("No events found");
      setTimeout(() => {
        if (fab) setFabLabel("Capture visible events");
      }, 2400);
      return;
    }

    let done = 0;
    let failed = 0;
    for (const card of cards) {
      setFabLabel(`Capturing ${done + failed + 1}/${cards.length}…`);
      try {
        await upsertEventLead({
          platformId: target.platformId,
          pageUrl: location.href,
          eventTitle: card.eventTitle,
          organizerName: card.organizerName,
          organizerHandle: null,
          priceRaw: null,
          socialUrl: null,
        });
        done += 1;
      } catch (err) {
        failed += 1;
        await appendEvent({
          level: "error",
          kind: "event-lead-capture-bulk",
          message:
            err && typeof err === "object" && "message" in err
              ? String(err.message)
              : String(err),
          context: { platformId: target.platformId, url: location.href, card },
        });
      }
    }

    setFabLabel(failed ? `✓ ${done} saved, ${failed} failed` : `✓ ${done} saved`);
    await appendEvent({
      level: failed ? "error" : "success",
      kind: "event-lead-capture-bulk",
      message: `bulk captured ${done}/${cards.length} eventpadi leads`,
      context: { platformId: target.platformId, url: location.href, done, failed },
    });
    setTimeout(() => {
      if (fab) setFabLabel("Capture visible events");
    }, 3200);
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
