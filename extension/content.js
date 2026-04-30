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
  const {
    detectProspect,
    scrapeProfileMeta,
    isHashtagPage,
    isPostPage,
    isFollowersPage,
    currentHashtag,
    extractVisibleHandles,
    IG_DOM_V,
    isPostModalOpen,
    getPostArticleRoot,
    extractPostAuthorFromOverlay,
    extractCommentAuthorsWithText,
    extractTaggedPeople,
    extractIntentQuote,
    observePostCommentList,
    localPreScore,
  } = detectModule;
  const {
    lookupProspect,
    upsertProspect,
    draftDm,
    fetchPrimaryTemplate,
    markDmSent,
    PulseApiError,
    capturedAppend,
    fetchOutboundFilters,
  } = apiModule;
  const { appendEvent, readLog, clearLog, withLogging } = logModule;

  let sidebar = null;
  let fab = null;
  let captureFab = null;
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
    ensureCaptureFab();
    if (!target && sidebar) {
      sidebar.remove();
      sidebar = null;
    }
    if (!target && logPanel) {
      logPanel.remove();
      logPanel = null;
    }
  }

  // ──────────────────────────────────────────────
  // Opportunistic capture FAB — lives on hashtag/post/followers
  // pages. Zero ban risk: one click harvests handles visible in the
  // viewport into local-only staging. Nothing hits Pulse until the
  // user reviews in the Captured tab.
  // ──────────────────────────────────────────────

  function shouldShowCaptureFab() {
    return isHashtagPage() || isPostPage() || isFollowersPage();
  }

  function ensureCaptureFab() {
    if (!shouldShowCaptureFab()) {
      if (captureFab) {
        captureFab.remove();
        captureFab = null;
      }
      return;
    }
    if (captureFab) {
      refreshCaptureCount();
      return;
    }
    captureFab = document.createElement("button");
    captureFab.className = "pulse-ext-capture-fab";
    captureFab.type = "button";
    captureFab.innerHTML = `
      <span class="pulse-ext-capture-fab__icon">⊕</span>
      <span class="pulse-ext-capture-fab__label">Capture visible</span>
      <span class="pulse-ext-capture-fab__count" data-pulse-capture-count>0</span>
    `;
    captureFab.addEventListener("click", handleOpportunisticCapture);
    document.body.appendChild(captureFab);
    refreshCaptureCount();
    // Refresh the count as IG lazy-loads more tiles on scroll.
    const poll = setInterval(() => {
      if (!captureFab || !document.body.contains(captureFab)) {
        clearInterval(poll);
        return;
      }
      refreshCaptureCount();
    }, 1500);
  }

  function refreshCaptureCount() {
    if (!captureFab) return;
    const handles = extractVisibleHandles(document);
    const el = captureFab.querySelector("[data-pulse-capture-count]");
    if (el) el.textContent = String(handles.length);
    captureFab.classList.toggle(
      "pulse-ext-capture-fab--empty",
      handles.length === 0
    );
  }

  async function handleOpportunisticCapture() {
    if (!captureFab) return;
    const labelEl = captureFab.querySelector(".pulse-ext-capture-fab__label");
    const originalLabel = labelEl?.textContent ?? "Capture visible";
    const setLabel = (text) => {
      if (labelEl) labelEl.textContent = text;
    };

    const handles = extractVisibleHandles(document);
    if (handles.length === 0) {
      setLabel("No handles visible yet");
      setTimeout(() => setLabel(originalLabel), 1800);
      return;
    }

    setLabel("Saving…");
    const sessionId = `sess_${Date.now()}`;
    const hashtag = currentHashtag();
    const items = handles.map((h) => ({
      platform: h.platform,
      handle: h.handle,
      profileUrl: h.profileUrl,
      postUrl: h.postUrl,
      hashtag,
      sessionId,
      source: "opportunistic",
    }));

    try {
      const res = await capturedAppend(items);
      const added = res?.added ?? 0;
      const skipped = res?.skipped ?? 0;
      await appendEvent({
        level: "success",
        kind: "capture-visible",
        message: `added ${added} · skipped ${skipped} (dedup)`,
        context: { hashtag, visible: handles.length, added, skipped },
      });
      setLabel(
        added > 0
          ? `✓ Saved ${added}${skipped > 0 ? ` (+${skipped} dup)` : ""}`
          : "All already captured"
      );
    } catch (err) {
      await appendEvent({
        level: "error",
        kind: "capture-visible",
        message:
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err),
        context: { hashtag, visible: handles.length },
      });
      setLabel("Save failed — open log");
      flashDebugBadge();
    }
    setTimeout(() => setLabel(originalLabel), 2400);
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

    // Ping the background via sendMessage so the user can SEE whether
    // the content script ↔ service worker pipeline is alive. If this
    // throws 'reading sync' or similar, the fix isn't actually loaded.
    let pipelineStatus = "ok";
    let pipelineDetail = "";
    let config = { baseUrl: "(unknown)", token: null };
    try {
      config = await apiModule.getConfig();
    } catch (err) {
      pipelineStatus = "fail";
      pipelineDetail =
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err);
    }
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
        <span>v${escapeHtml(chrome.runtime.getManifest().version)}</span>
        <span>Pipeline: <strong style="color: ${pipelineStatus === "ok" ? "#15803d" : "#b91c1c"}">${escapeHtml(pipelineStatus)}</strong></span>
      </div>
      ${
        pipelineStatus === "fail"
          ? `<div class="pulse-ext-log__pipeline-detail">Pipeline error: ${escapeHtml(pipelineDetail)}</div>`
          : ""
      }
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

  // ───────────────────────────────────────────────
  // Passive observer — the quality-lead capture engine
  //
  // The observer runs silently while the user browses IG normally.
  // No scrolling, clicking, or URL navigation is performed. When
  // something interesting mounts (a post modal opens, a comment
  // scrolls into view), we extract the author/commenter/tagged
  // handles + their intent quote, run a local pre-score against
  // the tenant's filter list, and stage the row in the captured
  // store. Nothing is uploaded until the user reviews in the
  // Captured page.
  // ───────────────────────────────────────────────

  let cachedFilters = null;
  let filtersFetchedAt = 0;
  const FILTERS_REFRESH_MS = 10 * 60 * 1000;
  let passiveSessionId = `sess_${Date.now()}`;
  let passiveSessionStartedAt = Date.now();
  let passiveActive = false;
  let localPassiveDisabled = false;
  let lastPassiveUrl = null;
  const capturedInSession = new Set();
  let currentPostArticle = null;
  let commentObserverTeardown = () => {};
  const feedArticleDwell = new WeakMap();
  let scrollSweepHandle = null;

  async function refreshFilters(force = false) {
    const stale = Date.now() - filtersFetchedAt > FILTERS_REFRESH_MS;
    if (!force && cachedFilters && !stale) return cachedFilters;
    try {
      const reply = await fetchOutboundFilters({ force });
      cachedFilters = reply?.filters ?? cachedFilters ?? null;
      filtersFetchedAt = Date.now();
    } catch {
      // Leave cachedFilters as-is; passive still works with whatever
      // we last had (or with null — localPreScore tolerates null).
    }
    return cachedFilters;
  }

  async function isLocalPassiveDisabled() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.sync?.get?.(
          "pulsePassiveDisabled",
          (stored) => resolve(stored?.pulsePassiveDisabled === true)
        );
      } catch {
        resolve(false);
      }
    });
  }

  function shouldBePassivelyActive() {
    if (typeof location === "undefined") return false;
    const host = location.hostname.replace(/^www\./, "");
    if (host !== "instagram.com") return false;
    if (localPassiveDisabled) return false;
    if (cachedFilters && cachedFilters.passiveCaptureEnabled === false) {
      return false;
    }
    return true;
  }

  function resetSession() {
    passiveSessionId = `sess_${Date.now()}`;
    passiveSessionStartedAt = Date.now();
    capturedInSession.clear();
  }

  function maybeRotateSession() {
    const tenMin = 10 * 60 * 1000;
    if (Date.now() - passiveSessionStartedAt > tenMin) resetSession();
  }

  function dwellMs() {
    const v = Number(cachedFilters?.dwellMs);
    return Number.isFinite(v) && v >= 400 ? v : 1200;
  }

  async function stageCapture({
    handle,
    sourceType,
    captionText = null,
    commentText = null,
    altText = null,
    displayName = null,
    postUrl = null,
    takenAt = null,
  }) {
    if (!handle) return;
    if (capturedInSession.has(handle)) return;
    capturedInSession.add(handle);

    const intentQuote = extractIntentQuote({
      sourceType,
      captionText,
      commentText,
      altText,
    });
    const qualifyLocal = localPreScore(
      { captionText, commentText, intentQuote, sourceType },
      cachedFilters
    );
    const hashtag = currentHashtag();
    const item = {
      platform: "instagram",
      handle,
      profileUrl: `https://www.instagram.com/${handle}/`,
      postUrl,
      hashtag,
      sessionId: passiveSessionId,
      source: "passive",
      sourceType,
      intentQuote,
      captionText,
      commentText,
      capturedFromUrl: location.href,
      passive: true,
      domVersion: IG_DOM_V.version,
      qualifyLocal,
      displayName,
      takenAt,
    };

    try {
      const res = await capturedAppend([item]);
      appendEvent({
        level: qualifyLocal.verdict === "discard" ? "info" : "success",
        kind: "passive-capture",
        message: `${sourceType} @${handle} · ${qualifyLocal.verdict}`,
        context: {
          handle,
          sourceType,
          verdict: qualifyLocal.verdict,
          keywords: qualifyLocal.matchedKeywords.join(",") || undefined,
          competitors: qualifyLocal.matchedCompetitors.join(",") || undefined,
          added: res?.added,
        },
      });
    } catch (err) {
      appendEvent({
        level: "error",
        kind: "passive-capture",
        message:
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err),
        context: { handle, sourceType },
      });
    }
  }

  function handleCommentIntersect(li) {
    const root = currentPostArticle ?? getPostArticleRoot();
    if (!root) return;
    // Extract all comments from the list and find the one whose li
    // matches our intersected node. Cheaper than per-li re-parse.
    const all = extractCommentAuthorsWithText(root);
    if (all.length === 0) return;
    const liText = (li.textContent ?? "").replace(/\s+/g, " ").trim();
    // Best-effort: match by handle prefix at start of liText, or by
    // substring of comment text.
    let match = null;
    for (const c of all) {
      if (liText.toLowerCase().startsWith(c.handle.toLowerCase())) {
        match = c;
        break;
      }
    }
    if (!match && all.length > 0) {
      // fallback: pick the most-similar-text comment
      match = all.find((c) => liText.includes(c.commentText.slice(0, 32)));
    }
    if (!match) return;
    stageCapture({
      handle: match.handle,
      sourceType: "commenter",
      commentText: match.commentText,
    });
  }

  async function onPostModalOpened(article) {
    if (!article || article === currentPostArticle) return;
    commentObserverTeardown();
    currentPostArticle = article;
    // Dwell for the caption/author extraction so we don't capture
    // an author whose modal the user immediately closed.
    const startedAt = Date.now();
    setTimeout(async () => {
      if (currentPostArticle !== article) return;
      if (Date.now() - startedAt < dwellMs() - 50) return;
      const author = extractPostAuthorFromOverlay(article);
      if (author?.handle) {
        await stageCapture({
          handle: author.handle,
          sourceType: "post_author",
          captionText: author.captionText,
          displayName: author.displayName,
          postUrl: author.postUrl,
          takenAt: author.takenAt,
        });
      }
      const tagged = extractTaggedPeople();
      for (const t of tagged) {
        if (t.handle === author?.handle) continue;
        await stageCapture({
          handle: t.handle,
          sourceType: "tagged",
          captionText: author?.captionText ?? null,
        });
      }
    }, dwellMs());

    commentObserverTeardown = observePostCommentList(
      article,
      handleCommentIntersect,
      { threshold: 0.5, dwellMs: dwellMs() }
    );
  }

  function sweepFeedArticles() {
    if (!passiveActive) return;
    if (isPostModalOpen()) return;
    if (!(isHashtagPage() || /\/explore(\/|$)/.test(location.pathname) || location.pathname === "/")) {
      return;
    }
    const articles = document.querySelectorAll("main article");
    for (const article of articles) {
      if (!(article instanceof Element)) continue;
      const rect = article.getBoundingClientRect();
      const inView =
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.height > 100;
      if (!inView) {
        feedArticleDwell.delete(article);
        continue;
      }
      const firstSeen = feedArticleDwell.get(article);
      if (!firstSeen) {
        feedArticleDwell.set(article, Date.now());
        continue;
      }
      if (Date.now() - firstSeen < dwellMs()) continue;
      // dwell met — extract author from alt + caption if available
      const img = article.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") ?? "";
      const authorMatch = /by\s+@([a-zA-Z0-9._]{2,30})\b/i.exec(alt);
      if (authorMatch) {
        const handle = authorMatch[1].toLowerCase();
        stageCapture({
          handle,
          sourceType: "post_author",
          altText: alt,
        });
        // Avoid re-firing on this article.
        feedArticleDwell.set(article, Number.MAX_SAFE_INTEGER);
      }
    }
  }

  function handlePassiveScroll() {
    if (scrollSweepHandle) return;
    scrollSweepHandle = setTimeout(() => {
      scrollSweepHandle = null;
      sweepFeedArticles();
    }, 300);
  }

  function onDomMutate() {
    if (!passiveActive) return;
    if (isPostModalOpen()) {
      const article = getPostArticleRoot();
      if (article) onPostModalOpened(article);
    } else if (currentPostArticle) {
      commentObserverTeardown();
      commentObserverTeardown = () => {};
      currentPostArticle = null;
    }
  }

  function startPassive() {
    if (passiveActive) return;
    passiveActive = true;
    window.addEventListener("scroll", handlePassiveScroll, { passive: true });
  }

  function stopPassive() {
    if (!passiveActive) return;
    passiveActive = false;
    commentObserverTeardown();
    commentObserverTeardown = () => {};
    currentPostArticle = null;
    window.removeEventListener("scroll", handlePassiveScroll);
  }

  async function refreshPassiveActivation() {
    localPassiveDisabled = await isLocalPassiveDisabled();
    await refreshFilters();
    if (shouldBePassivelyActive()) {
      startPassive();
      onDomMutate();
    } else {
      stopPassive();
    }
  }

  function onPassiveUrlChange() {
    maybeRotateSession();
    if (location.href !== lastPassiveUrl) {
      lastPassiveUrl = location.href;
      // URL change often implies a different hashtag/post — rotate
      // session so dedup doesn't suppress legitimate re-captures.
      resetSession();
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
  refreshPassiveActivation();
  // Refresh filters + activation every 10 min in long-lived tabs.
  setInterval(refreshPassiveActivation, FILTERS_REFRESH_MS);
  // React to options-page toggle changes without a reload.
  try {
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area === "sync" && "pulsePassiveDisabled" in changes) {
        refreshPassiveActivation();
      }
    });
  } catch {
    // noop
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPassiveUrlChange();
      syncToCurrentPage();
    }
    onDomMutate();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", () => {
    onPassiveUrlChange();
    syncToCurrentPage();
  });
})();
