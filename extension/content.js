// Content script v2 — Phase B flip.
//
// Priye's real workflow:
//   1. Land on a profile
//   2. One-click "Save to Pulse" (upsert + stay scrolling)
//   3. Optionally "Copy primary template" to paste in the platform's DM composer
//   4. "Draft personalized DM" is still there but demoted — the rare custom outreach
//
// No auto-send, no scraping of DMs, no automation IG/TikTok can fingerprint.

(async () => {
  const detectModule = await import(chrome.runtime.getURL("lib/detect.js"));
  const apiModule = await import(chrome.runtime.getURL("lib/api.js"));
  const { detectProspect, scrapeProfileMeta } = detectModule;
  const {
    lookupProspect,
    upsertProspect,
    draftDm,
    fetchPrimaryTemplate,
    markDmSent,
    PulseApiError,
  } = apiModule;

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
      <span class="pulse-ext-fab__label">Save to Pulse</span>
    `;
    fab.addEventListener("click", () => handleQuickSave(target));
    document.body.appendChild(fab);
  }

  async function handleQuickSave(target) {
    if (!fab) return;
    const originalLabel = fab.querySelector(".pulse-ext-fab__label")?.textContent;
    setFabLabel("Saving…");
    const meta = scrapeProfileMeta(target.platform);
    try {
      const res = await upsertProspect({
        platform: target.platform,
        handle: target.handle,
        profileUrl: target.profileUrl,
        displayName: meta.displayName,
        bio: meta.bio,
      });
      cachedProspect = res.prospect ?? null;
      cachedDm = res.dm ?? null;
      setFabLabel(
        res.prospect?.status === "qualified"
          ? "✓ Saved (qualified)"
          : "✓ Saved"
      );
      setTimeout(() => {
        if (fab) setFabLabel(originalLabel ?? "Save to Pulse");
      }, 1800);
    } catch (err) {
      const msg =
        err instanceof PulseApiError
          ? err.status === 401
            ? "Token missing"
            : err.message
          : "Save failed";
      setFabLabel(msg);
      setTimeout(() => {
        if (fab) setFabLabel(originalLabel ?? "Save to Pulse");
      }, 2200);
    }
  }

  function setFabLabel(text) {
    const label = fab?.querySelector(".pulse-ext-fab__label");
    if (label) label.textContent = text;
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

    sidebar
      .querySelector("[data-pulse-close]")
      ?.addEventListener("click", () => {
        sidebar?.remove();
        sidebar = null;
      });

    sidebar
      .querySelector("[data-pulse-save]")
      ?.addEventListener("click", () => handleSave(target));
    sidebar
      .querySelector("[data-pulse-refresh]")
      ?.addEventListener("click", () => handleLookup(target));

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
        <button data-pulse-refresh class="pulse-ext-btn pulse-ext-btn--ghost">
          Refresh
        </button>
        <button data-pulse-save class="pulse-ext-btn pulse-ext-btn--primary">
          Save to Pulse
        </button>
      </div>
    `;
  }

  function renderBody(html) {
    const body = sidebar?.querySelector("[data-pulse-body]");
    if (body) body.innerHTML = html;
  }

  async function handleLookup(target) {
    renderBody(
      `<div class="pulse-ext-empty">Checking Pulse for @${escapeHtml(target.handle)}…</div>`
    );
    try {
      const data = await lookupProspect({
        platform: target.platform,
        handle: target.handle,
      });
      cachedProspect = data.prospect ?? null;
      cachedDm = data.dm ?? null;
      renderSidebarContent(target);
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleSave(target) {
    renderBody(`<div class="pulse-ext-empty">Saving @${escapeHtml(target.handle)}…</div>`);
    const meta = scrapeProfileMeta(target.platform);
    try {
      const res = await upsertProspect({
        platform: target.platform,
        handle: target.handle,
        profileUrl: target.profileUrl,
        displayName: meta.displayName,
        bio: meta.bio,
      });
      cachedProspect = res.prospect ?? null;
      cachedDm = res.dm ?? null;
      renderSidebarContent(target);
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleCopyPrimary(target) {
    try {
      const res = await fetchPrimaryTemplate(target.platform);
      if (!res.template) {
        renderBody(
          `<div class="pulse-ext-empty">No primary template set for ${target.platform}. Open Pulse → Outbound → Templates, mark one as Primary, then try again.</div>`
        );
        return;
      }
      await navigator.clipboard.writeText(res.template.body);
      flashFabTemp("Template copied — paste into the DM box", 2000);
      renderSidebarContent(target, {
        toast: `Copied "${res.template.name}" — paste it into the DM composer.`,
      });
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleDraft(target) {
    renderBody(
      `<div class="pulse-ext-empty">Drafting personalized DM in your brand voice…</div>`
    );
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
      cachedDm = data.dm ?? null;
      cachedProspect = data.prospect ?? cachedProspect;
      renderSidebarContent(target, { preferDm: true });
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  async function handleMarkSent(target) {
    if (!cachedDm) return;
    try {
      await markDmSent(cachedDm.id);
      flashFabTemp("Marked sent in Pulse", 1500);
      handleLookup(target);
    } catch (err) {
      renderBody(errorBlock(err));
    }
  }

  function renderSidebarContent(target, opts = {}) {
    const { toast, preferDm } = opts;
    const blocks = [];

    if (toast) {
      blocks.push(
        `<div class="pulse-ext-toast">${escapeHtml(toast)}</div>`
      );
    }

    if (!cachedProspect) {
      blocks.push(`
        <div class="pulse-ext-empty">
          @${escapeHtml(target.handle)} is not in Pulse yet. Click
          <strong>Save to Pulse</strong> below to add them.
        </div>
      `);
    } else {
      blocks.push(buildStatusBlock(cachedProspect));
      blocks.push(buildPrimaryActionsBlock(target));
      if (preferDm && cachedDm) {
        blocks.push(buildDmBlock(cachedDm));
      } else if (cachedDm) {
        blocks.push(buildDmSummaryBlock(cachedDm));
      }
      blocks.push(buildAdvancedBlock());
    }

    renderBody(blocks.join("\n"));

    // Re-bind the buttons that live in the rendered body.
    sidebar
      ?.querySelector("[data-pulse-copy-primary]")
      ?.addEventListener("click", () => handleCopyPrimary(target));
    sidebar
      ?.querySelector("[data-pulse-draft]")
      ?.addEventListener("click", () => handleDraft(target));
    sidebar
      ?.querySelector("[data-pulse-mark-sent]")
      ?.addEventListener("click", () => handleMarkSent(target));
    sidebar
      ?.querySelector("[data-pulse-copy-dm]")
      ?.addEventListener("click", async () => {
        const textarea = sidebar?.querySelector("[data-pulse-body-text]");
        const text = textarea?.value ?? cachedDm?.body ?? "";
        try {
          await navigator.clipboard.writeText(text);
          flashFabTemp("Copied", 1200);
        } catch {
          flashFabTemp("Couldn't copy", 1500);
        }
      });
  }

  function buildStatusBlock(prospect) {
    const statusLabel = escapeHtml(prospect.status ?? "new");
    const score =
      prospect.qualificationScore != null
        ? `<span class="pulse-ext-chip pulse-ext-chip--primary">${prospect.qualificationScore}/100</span>`
        : "";
    const reason = prospect.qualificationReason
      ? `<p class="pulse-ext-muted">${escapeHtml(prospect.qualificationReason)}</p>`
      : "";
    return `
      <div class="pulse-ext-status">
        <div class="pulse-ext-row">
          <span class="pulse-ext-chip">${statusLabel}</span>
          ${score}
        </div>
        ${reason}
      </div>
    `;
  }

  function buildPrimaryActionsBlock(target) {
    return `
      <div class="pulse-ext-actions">
        <button data-pulse-copy-primary class="pulse-ext-btn pulse-ext-btn--primary">
          Copy primary template
        </button>
      </div>
      <p class="pulse-ext-muted">
        Paste into ${target.platform}'s DM box and send yourself.
      </p>
    `;
  }

  function buildDmSummaryBlock(dm) {
    return `
      <div class="pulse-ext-card">
        <div class="pulse-ext-card__meta">
          Personalized draft · v${dm.version} · ${escapeHtml(dm.status ?? "drafted")}
        </div>
        <p class="pulse-ext-muted">
          Pulse drafted a custom DM for this prospect. Expand below to view + copy.
        </p>
      </div>
    `;
  }

  function buildDmBlock(dm) {
    return `
      <div class="pulse-ext-card">
        <div class="pulse-ext-card__meta">
          Personalized draft · v${dm.version} · ${escapeHtml(dm.status ?? "drafted")}
        </div>
        <textarea data-pulse-body-text class="pulse-ext-textarea" rows="6">${escapeHtml(dm.body)}</textarea>
        <div class="pulse-ext-actions">
          <button data-pulse-copy-dm class="pulse-ext-btn pulse-ext-btn--primary">Copy draft</button>
          <button data-pulse-mark-sent class="pulse-ext-btn pulse-ext-btn--ghost">Mark sent</button>
        </div>
      </div>
    `;
  }

  function buildAdvancedBlock() {
    return `
      <details class="pulse-ext-details">
        <summary>More</summary>
        <div class="pulse-ext-details__body">
          <button data-pulse-draft class="pulse-ext-btn pulse-ext-btn--ghost">
            Draft personalized DM
          </button>
          <p class="pulse-ext-muted">
            For the rare prospect where the template won't land without tailoring.
          </p>
        </div>
      </details>
    `;
  }

  function errorBlock(err) {
    const msg =
      err instanceof PulseApiError
        ? err.status === 401
          ? "No Pulse API token. Right-click the Pulse icon → Options to paste one."
          : err.message
        : err?.message ?? "Request failed";
    return `<div class="pulse-ext-error">${escapeHtml(msg)}</div>`;
  }

  function flashFabTemp(text, ms) {
    if (!fab) return;
    const label = fab.querySelector(".pulse-ext-fab__label");
    const original = label?.textContent ?? "Save to Pulse";
    if (label) label.textContent = text;
    setTimeout(() => {
      if (label) label.textContent = original;
    }, ms ?? 1600);
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

  // Right-click the FAB to open the sidebar (save is still one click).
  document.addEventListener("contextmenu", (e) => {
    if (!fab || !(e.target instanceof Node) || !fab.contains(e.target)) return;
    e.preventDefault();
    const target = currentTarget();
    if (target) openSidebar(target);
  });

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
