// Content script: injects a floating "Draft with Pulse" button onto
// IG / TikTok / Twitter / LinkedIn profile pages. Clicking opens a
// sidebar with the AI draft. Single-file, no bundler — reads helpers
// via dynamic import since content scripts don't support static
// imports in MV3 without a bundler.

(async () => {
  const detectModule = await import(chrome.runtime.getURL("lib/detect.js"));
  const apiModule = await import(chrome.runtime.getURL("lib/api.js"));
  const { detectProspect, scrapeProfileMeta } = detectModule;
  const { lookupProspect, draftDm, PulseApiError } = apiModule;

  let sidebar = null;
  let fab = null;
  let lastUrl = location.href;
  let cachedProspect = null;
  let cachedDm = null;

  function currentTarget() {
    return detectProspect(location.href);
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
    fab = document.createElement("button");
    fab.className = "pulse-ext-fab";
    fab.type = "button";
    fab.innerHTML = `
      <span class="pulse-ext-fab__logo">◐</span>
      <span class="pulse-ext-fab__label">Draft with Pulse</span>
    `;
    fab.addEventListener("click", () => openSidebar(target));
    document.body.appendChild(fab);
  }

  function openSidebar(target) {
    if (sidebar) {
      sidebar.remove();
      sidebar = null;
    }
    sidebar = document.createElement("div");
    sidebar.className = "pulse-ext-sidebar";
    sidebar.innerHTML = buildSidebarHtml(target);
    document.body.appendChild(sidebar);

    sidebar.querySelector("[data-pulse-close]")?.addEventListener("click", () => {
      sidebar?.remove();
      sidebar = null;
    });

    const draftBtn = sidebar.querySelector("[data-pulse-draft]");
    const existingBtn = sidebar.querySelector("[data-pulse-existing]");
    const copyBtn = sidebar.querySelector("[data-pulse-copy]");
    const markSentBtn = sidebar.querySelector("[data-pulse-mark-sent]");

    draftBtn?.addEventListener("click", () => handleDraft(target));
    existingBtn?.addEventListener("click", () => handleLookup(target));
    copyBtn?.addEventListener("click", () => handleCopy());
    markSentBtn?.addEventListener("click", () => handleMarkSent(target));

    // Auto-lookup on open so the user immediately sees if this prospect
    // already has a draft.
    handleLookup(target);
  }

  function buildSidebarHtml(target) {
    return `
      <div class="pulse-ext-sidebar__header">
        <div>
          <div class="pulse-ext-sidebar__title">Pulse</div>
          <div class="pulse-ext-sidebar__subtitle">
            @${target.handle} · ${target.platform}
          </div>
        </div>
        <button data-pulse-close class="pulse-ext-sidebar__close" aria-label="Close">×</button>
      </div>
      <div data-pulse-body class="pulse-ext-sidebar__body">
        <div class="pulse-ext-empty">Loading prospect…</div>
      </div>
      <div class="pulse-ext-sidebar__footer">
        <button data-pulse-existing class="pulse-ext-btn pulse-ext-btn--ghost">
          Refresh
        </button>
        <button data-pulse-draft class="pulse-ext-btn pulse-ext-btn--primary">
          Draft new DM
        </button>
      </div>
    `;
  }

  function renderBody(html) {
    const body = sidebar?.querySelector("[data-pulse-body]");
    if (body) body.innerHTML = html;
  }

  function renderDm(dm, prospect) {
    cachedDm = dm;
    cachedProspect = prospect;
    renderBody(`
      <div class="pulse-ext-card">
        <div class="pulse-ext-card__meta">
          Draft v${dm.version} · ${dm.status}
        </div>
        <textarea data-pulse-body-text class="pulse-ext-textarea" rows="8">${escapeHtml(dm.body)}</textarea>
        ${dm.followupBody ? `
          <div class="pulse-ext-followup">
            <div class="pulse-ext-followup__label">Follow-up if no reply in 3d</div>
            <div class="pulse-ext-followup__text">${escapeHtml(dm.followupBody)}</div>
          </div>
        ` : ""}
        <div class="pulse-ext-actions">
          <button data-pulse-copy class="pulse-ext-btn pulse-ext-btn--primary">Copy DM</button>
          <button data-pulse-mark-sent class="pulse-ext-btn pulse-ext-btn--ghost">Mark sent in Pulse</button>
        </div>
      </div>
      ${prospect?.qualificationReason ? `
        <div class="pulse-ext-qualifier">
          <div class="pulse-ext-qualifier__label">AI fit · ${prospect.qualificationScore ?? "?"}/100</div>
          <div class="pulse-ext-qualifier__text">${escapeHtml(prospect.qualificationReason)}</div>
        </div>
      ` : ""}
    `);

    // Re-bind copy/mark-sent handlers on the new DOM.
    sidebar?.querySelector("[data-pulse-copy]")?.addEventListener("click", handleCopy);
    sidebar?.querySelector("[data-pulse-mark-sent]")?.addEventListener("click", () => {
      const target = currentTarget();
      if (target) handleMarkSent(target);
    });
  }

  async function handleLookup(target) {
    renderBody(`<div class="pulse-ext-empty">Looking up @${escapeHtml(target.handle)}…</div>`);
    try {
      const data = await lookupProspect({
        platform: target.platform,
        handle: target.handle,
      });
      if (data.dm) {
        renderDm(data.dm, data.prospect);
      } else if (data.prospect) {
        cachedProspect = data.prospect;
        renderBody(`
          <div class="pulse-ext-empty">
            Prospect in Pulse (status: <strong>${escapeHtml(data.prospect.status)}</strong>)
            — no draft yet. Click <em>Draft new DM</em> below.
          </div>
        `);
      } else {
        cachedProspect = null;
        renderBody(`
          <div class="pulse-ext-empty">
            Not in Pulse yet. Click <em>Draft new DM</em> — we'll add them and write the message.
          </div>
        `);
      }
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleDraft(target) {
    renderBody(`<div class="pulse-ext-empty">Drafting with your brand voice…</div>`);
    const meta = scrapeProfileMeta(target.platform);
    try {
      const data = await draftDm({
        platform: target.platform,
        handle: target.handle,
        profileUrl: target.profileUrl,
        displayName: meta.displayName,
        bio: meta.bio,
        signalSummary: meta.bio
          ? `Profile bio: ${meta.bio.slice(0, 200)}`
          : undefined,
      });
      renderDm(data.dm, data.prospect);
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleCopy() {
    const textarea = sidebar?.querySelector("[data-pulse-body-text]");
    const text = textarea?.value ?? cachedDm?.body ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashFab("Copied to clipboard");
    } catch {
      flashFab("Couldn't copy");
    }
  }

  async function handleMarkSent(target) {
    if (!cachedDm) return;
    try {
      const { getConfig } = apiModule;
      const { baseUrl, token } = await getConfig();
      const res = await fetch(`${baseUrl}/api/ext/dm/${cachedDm.id}/sent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        flashFab("Marked sent in Pulse");
        handleLookup(target);
      } else {
        flashFab("Couldn't mark sent — open Pulse");
      }
    } catch {
      flashFab("Couldn't mark sent");
    }
  }

  function errorBlock(err) {
    const msg =
      err instanceof PulseApiError
        ? err.status === 401
          ? "No Pulse API token. Right-click the Pulse icon → Options to paste one."
          : err.message
        : (err?.message ?? "Request failed");
    return `<div class="pulse-ext-error">${escapeHtml(msg)}</div>`;
  }

  function flashFab(text) {
    if (!fab) return;
    const label = fab.querySelector(".pulse-ext-fab__label");
    const original = label?.textContent ?? "Draft with Pulse";
    if (label) label.textContent = text;
    setTimeout(() => {
      if (label) label.textContent = original;
    }, 1600);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function syncToCurrentPage() {
    const target = currentTarget();
    ensureFab(target);
    if (!target && sidebar) {
      sidebar.remove();
      sidebar = null;
    }
  }

  // Initial sync, then watch for SPA navigations (IG/TikTok/LinkedIn
  // all do this).
  syncToCurrentPage();
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncToCurrentPage();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", syncToCurrentPage);
})();
