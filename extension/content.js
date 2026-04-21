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
  const logModule = await import(chrome.runtime.getURL("lib/log.js"));
  const { detectProspect, scrapeProfileMeta } = detectModule;
  const {
    lookupProspect,
    upsertProspect,
    draftDm,
    fetchPrimaryTemplate,
    markDmSent,
    PulseApiError,
  } = apiModule;
  const { appendEvent, readLog, clearLog, withLogging } = logModule;

  let sidebar = null;
  let fab = null;
  let logPanel = null;
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

    // Wrap the save button + a small debug icon so they render as a unit.
    fab = document.createElement("div");
    fab.className = "pulse-ext-fab-group";

    const saveBtn = document.createElement("button");
    saveBtn.className = "pulse-ext-fab";
    saveBtn.type = "button";
    saveBtn.innerHTML = `
      <span class="pulse-ext-fab__logo">◐</span>
      <span class="pulse-ext-fab__label">Save to Pulse</span>
    `;
    saveBtn.addEventListener("click", () => handleQuickSave(target));

    const debugBtn = document.createElement("button");
    debugBtn.className = "pulse-ext-fab-debug";
    debugBtn.type = "button";
    debugBtn.title = "View Pulse event log (last 30 actions)";
    debugBtn.setAttribute("aria-label", "View event log");
    debugBtn.textContent = "⟳";
    debugBtn.addEventListener("click", () => toggleLogPanel(target));

    fab.appendChild(saveBtn);
    fab.appendChild(debugBtn);
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
      const qualified = res.prospect?.status === "qualified";
      setFabLabel(qualified ? "✓ Saved (qualified)" : "✓ Saved");
      appendEvent({
        level: "success",
        kind: "quick-save",
        message: qualified ? "saved · qualified" : "saved",
        context: {
          platform: target.platform,
          handle: target.handle,
          url: target.profileUrl,
        },
      });
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
      appendEvent({
        level: "error",
        kind: "quick-save",
        message:
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err),
        context: {
          platform: target.platform,
          handle: target.handle,
          url: target.profileUrl,
          status:
            err && typeof err === "object" && "status" in err
              ? err.status
              : undefined,
        },
      });
      setTimeout(() => {
        if (fab) setFabLabel(originalLabel ?? "Save to Pulse");
      }, 2200);
      // Let the user pop the log panel to see the full error.
      flashDebugBadge();
    }
  }

  function setFabLabel(text) {
    const label = fab?.querySelector(".pulse-ext-fab__label");
    if (label) label.textContent = text;
  }

  function flashDebugBadge() {
    const btn = fab?.querySelector(".pulse-ext-fab-debug");
    if (!btn) return;
    btn.classList.add("pulse-ext-fab-debug--alert");
    setTimeout(() => {
      btn?.classList.remove("pulse-ext-fab-debug--alert");
    }, 4000);
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
      const data = await withLogging(
        "lookup",
        { platform: target.platform, handle: target.handle },
        () =>
          lookupProspect({
            platform: target.platform,
            handle: target.handle,
          })
      );
      cachedProspect = data.prospect ?? null;
      cachedDm = data.dm ?? null;
      renderSidebarContent(target);
    } catch (err) {
      renderBody(errorBlock(err));
      flashDebugBadge();
    }
  }

  async function handleSave(target) {
    renderBody(`<div class="pulse-ext-empty">Saving @${escapeHtml(target.handle)}…</div>`);
    const meta = scrapeProfileMeta(target.platform);
    try {
      const res = await withLogging(
        "save",
        { platform: target.platform, handle: target.handle },
        () =>
          upsertProspect({
            platform: target.platform,
            handle: target.handle,
            profileUrl: target.profileUrl,
            displayName: meta.displayName,
            bio: meta.bio,
          })
      );
      cachedProspect = res.prospect ?? null;
      cachedDm = res.dm ?? null;
      renderSidebarContent(target);
    } catch (err) {
      renderBody(errorBlock(err));
      flashDebugBadge();
    }
  }

  async function handleCopyPrimary(target) {
    try {
      const res = await withLogging(
        "copy-primary",
        { platform: target.platform, handle: target.handle },
        () => fetchPrimaryTemplate(target.platform)
      );
      if (!res.template) {
        await appendEvent({
          level: "warn",
          kind: "copy-primary",
          message: `no primary template set for ${target.platform}`,
          context: { platform: target.platform },
        });
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
      flashDebugBadge();
    }
  }

  async function handleDraft(target) {
    renderBody(
      `<div class="pulse-ext-empty">Drafting personalized DM in your brand voice…</div>`
    );
    const meta = scrapeProfileMeta(target.platform);
    try {
      const data = await withLogging(
        "draft",
        { platform: target.platform, handle: target.handle },
        () =>
          draftDm({
            platform: target.platform,
            handle: target.handle,
            profileUrl: target.profileUrl,
            displayName: meta.displayName,
            bio: meta.bio,
            signalSummary: meta.bio
              ? `Profile bio: ${meta.bio.slice(0, 200)}`
              : undefined,
          })
      );
      cachedDm = data.dm ?? null;
      cachedProspect = data.prospect ?? cachedProspect;
      renderSidebarContent(target, { preferDm: true });
    } catch (err) {
      renderBody(errorBlock(err));
      flashDebugBadge();
    }
  }

  async function handleMarkSent(target) {
    if (!cachedDm) return;
    try {
      await withLogging(
        "mark-sent",
        { dmId: cachedDm.id },
        () => markDmSent(cachedDm.id)
      );
      flashFabTemp("Marked sent in Pulse", 1500);
      handleLookup(target);
    } catch (err) {
      renderBody(errorBlock(err));
      flashDebugBadge();
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
    if (!target && logPanel) {
      logPanel.remove();
      logPanel = null;
    }
  }

  // ───────────────────────────────────────────────
  // Debug / event log
  // ───────────────────────────────────────────────

  async function toggleLogPanel(target) {
    if (logPanel) {
      logPanel.remove();
      logPanel = null;
      return;
    }
    logPanel = document.createElement("div");
    logPanel.className = "pulse-ext-log";
    document.body.appendChild(logPanel);
    await renderLogPanel(target);
  }

  async function renderLogPanel(target) {
    if (!logPanel) return;
    const entries = await readLog();
    const config = await apiModule.getConfig();
    const tokenStatus = config.token ? "set" : "missing";
    const baseUrl = config.baseUrl ?? "(default)";
    logPanel.innerHTML = `
      <div class="pulse-ext-log__header">
        <div>
          <div class="pulse-ext-log__title">Pulse event log</div>
          <div class="pulse-ext-log__subtitle">
            Last ${entries.length} event${entries.length === 1 ? "" : "s"}
          </div>
        </div>
        <div class="pulse-ext-log__actions">
          <button data-pulse-log-refresh class="pulse-ext-log__action" title="Refresh">↻</button>
          <button data-pulse-log-clear class="pulse-ext-log__action" title="Clear log">clear</button>
          <button data-pulse-log-close class="pulse-ext-log__action" aria-label="Close">×</button>
        </div>
      </div>
      <div class="pulse-ext-log__body">
        ${entries.length === 0 ? emptyLogBlock() : entries.map(renderLogEntry).join("")}
      </div>
      <div class="pulse-ext-log__footer">
        <span>Token: <strong>${escapeHtml(tokenStatus)}</strong></span>
        <span>Base: <code>${escapeHtml(baseUrl)}</code></span>
      </div>
    `;
    logPanel
      .querySelector("[data-pulse-log-close]")
      ?.addEventListener("click", () => toggleLogPanel(target));
    logPanel
      .querySelector("[data-pulse-log-refresh]")
      ?.addEventListener("click", () => renderLogPanel(target));
    logPanel
      .querySelector("[data-pulse-log-clear]")
      ?.addEventListener("click", async () => {
        await clearLog();
        renderLogPanel(target);
      });
  }

  function emptyLogBlock() {
    return `
      <div class="pulse-ext-log__empty">
        <p>No events yet.</p>
        <p>As you save prospects, copy templates, or draft DMs, each
        action lands here with success/error detail so you can debug
        without reloading the page.</p>
      </div>
    `;
  }

  function renderLogEntry(entry) {
    const levelClass = `pulse-ext-log__entry--${entry.level ?? "info"}`;
    const ts = new Date(entry.ts).toLocaleTimeString();
    const ctx = entry.context
      ? Object.entries(entry.context)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(
            ([k, v]) =>
              `<code>${escapeHtml(k)}=${escapeHtml(String(v))}</code>`
          )
          .join(" ")
      : "";
    return `
      <div class="pulse-ext-log__entry ${levelClass}">
        <div class="pulse-ext-log__meta">
          <span class="pulse-ext-log__kind">${escapeHtml(entry.kind ?? "event")}</span>
          <span class="pulse-ext-log__ts">${escapeHtml(ts)}</span>
        </div>
        <div class="pulse-ext-log__message">${escapeHtml(entry.message ?? "")}</div>
        ${ctx ? `<div class="pulse-ext-log__context">${ctx}</div>` : ""}
      </div>
    `;
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
