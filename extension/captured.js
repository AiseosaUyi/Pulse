import {
  bulkUploadProspects,
  capturedDelete,
  capturedList,
  capturedUpdateStatus,
  getConfig,
} from "./lib/api.js";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let all = [];               // every captured entry (unfiltered)
let selected = new Set();   // entry ids selected by the user
let filter = "local";       // 'local' | 'uploaded' | 'all'
let search = "";

// ─────────────────────────────────────────────
// Elements
// ─────────────────────────────────────────────
const subEl = document.getElementById("sub");
const listEl = document.getElementById("list");
const alertEl = document.getElementById("alert");
const uploadBtn = document.getElementById("upload");
const deleteBtn = document.getElementById("delete");
const exportBtn = document.getElementById("export");
const selectAllBtn = document.getElementById("select-all");
const deselectBtn = document.getElementById("deselect");
const searchEl = document.getElementById("search");
const openLeadsLink = document.getElementById("open-leads");
const ftrStatusEl = document.getElementById("ftr-status");
const filterRadios = document.querySelectorAll("input[name='filter']");

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
(async () => {
  await refresh();
  setupEvents();
  setupLeadsLink();
})();

async function setupLeadsLink() {
  try {
    const { baseUrl } = await getConfig();
    openLeadsLink.href = `${baseUrl}/leads`;
    openLeadsLink.target = "_blank";
  } catch {
    // ignore — link still functional as a no-op
  }
}

// ─────────────────────────────────────────────
// Data load
// ─────────────────────────────────────────────
async function refresh() {
  try {
    all = await capturedList();
  } catch (err) {
    showAlert(`Couldn't load captured list: ${err?.message ?? err}`, "error");
    all = [];
  }
  render();
}

// ─────────────────────────────────────────────
// Filtering + rendering
// ─────────────────────────────────────────────
function visibleEntries() {
  const q = search.trim().toLowerCase();
  return all.filter((e) => {
    if (filter !== "all" && e.status !== filter) return false;
    if (!q) return true;
    return (
      e.handle.toLowerCase().includes(q) ||
      (e.hashtag ?? "").toLowerCase().includes(q)
    );
  });
}

function groupByHashtag(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.hashtag ? `#${e.hashtag}` : "(no hashtag)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return Array.from(groups.entries()).sort((a, b) => {
    // Largest group first.
    return b[1].length - a[1].length;
  });
}

function render() {
  const entries = visibleEntries();
  updateSummary();
  if (entries.length === 0) {
    listEl.innerHTML =
      '<p class="empty">Nothing captured in this view yet. Visit an Instagram hashtag or post page and click "Capture visible" on the extension FAB.</p>';
    updateActionBar();
    return;
  }

  const groups = groupByHashtag(entries);
  const html = groups
    .map(([tag, items]) => {
      const header = `
        <div class="group-hdr">
          <span><strong>${escapeHtml(tag)}</strong> · ${items.length} captured</span>
          <span>
            <button class="icon-btn" data-group-select="${escapeHtml(tag)}">
              Select all in group
            </button>
          </span>
        </div>
      `;
      const rows = items.map(renderRow).join("");
      return `<div class="group">${header}${rows}</div>`;
    })
    .join("");
  listEl.innerHTML = html;
  updateActionBar();

  // Row-level event binding
  listEl.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", handleRowToggle);
  });
  listEl.querySelectorAll("[data-action='delete-one']").forEach((b) => {
    b.addEventListener("click", handleDeleteOne);
  });
  listEl.querySelectorAll("[data-action='skip-one']").forEach((b) => {
    b.addEventListener("click", handleSkipOne);
  });
  listEl.querySelectorAll("[data-group-select]").forEach((b) => {
    b.addEventListener("click", handleGroupSelect);
  });
}

function renderRow(entry) {
  const ageLabel = formatAge(entry.capturedAt);
  const sourceLabel =
    entry.source === "scheduled" ? "scheduled crawl" : "captured visible";
  const postBadge = entry.postUrl
    ? `<a href="${escapeHtml(entry.postUrl)}" target="_blank" rel="noreferrer" class="icon-btn">from post</a>`
    : "";
  const checked = selected.has(entry.id) ? "checked" : "";
  const disabled = entry.status !== "local" ? "disabled" : "";
  return `
    <div class="row" data-id="${escapeHtml(entry.id)}">
      <input type="checkbox" data-id="${escapeHtml(entry.id)}" ${checked} ${disabled} />
      <div>
        <a class="handle" href="${escapeHtml(entry.profileUrl ?? "#")}" target="_blank" rel="noreferrer">
          @${escapeHtml(entry.handle)}
        </a>
        <div class="meta">
          ${ageLabel} · ${escapeHtml(sourceLabel)}
          ${entry.hashtag ? ` · #${escapeHtml(entry.hashtag)}` : ""}
        </div>
      </div>
      <div>
        <span class="status-pill ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
        ${postBadge}
      </div>
      <div>
        ${
          entry.status === "local"
            ? `<button class="icon-btn" data-action="skip-one" data-id="${escapeHtml(entry.id)}">skip</button>`
            : ""
        }
        <button class="icon-btn" data-action="delete-one" data-id="${escapeHtml(entry.id)}">delete</button>
      </div>
    </div>
  `;
}

function updateSummary() {
  const local = all.filter((e) => e.status === "local").length;
  const uploaded = all.filter((e) => e.status === "uploaded").length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = all.filter(
    (e) => new Date(e.capturedAt).toISOString().slice(0, 10) === todayKey
  ).length;
  subEl.textContent = `${all.length} captured total · ${local} local · ${uploaded} uploaded · ${today} today`;
  ftrStatusEl.textContent =
    local > 0
      ? `${local} prospect${local === 1 ? "" : "s"} ready to upload`
      : uploaded > 0
        ? "All captured prospects uploaded"
        : "Nothing to upload yet";
}

function updateActionBar() {
  const hasSelection = selected.size > 0;
  uploadBtn.disabled = !hasSelection;
  deleteBtn.disabled = !hasSelection;
  uploadBtn.textContent = hasSelection
    ? `Upload ${selected.size} to Pulse`
    : "Upload to Pulse";
  deleteBtn.textContent = hasSelection ? `Delete ${selected.size}` : "Delete";
}

// ─────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────
function setupEvents() {
  filterRadios.forEach((r) => {
    r.addEventListener("change", () => {
      filter = r.value;
      // Clear selection on filter change — can't act on rows you can't see.
      selected.clear();
      render();
    });
  });

  searchEl.addEventListener("input", () => {
    search = searchEl.value;
    render();
  });

  selectAllBtn.addEventListener("click", () => {
    visibleEntries()
      .filter((e) => e.status === "local")
      .forEach((e) => selected.add(e.id));
    render();
  });

  deselectBtn.addEventListener("click", () => {
    selected.clear();
    render();
  });

  uploadBtn.addEventListener("click", handleUpload);
  deleteBtn.addEventListener("click", handleDelete);
  exportBtn.addEventListener("click", handleExport);
}

function handleRowToggle(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) selected.add(id);
  else selected.delete(id);
  updateActionBar();
}

function handleGroupSelect(e) {
  const tag = e.target.dataset.groupSelect;
  visibleEntries()
    .filter(
      (entry) =>
        entry.status === "local" &&
        (tag === "(no hashtag)"
          ? !entry.hashtag
          : entry.hashtag && `#${entry.hashtag}` === tag)
    )
    .forEach((entry) => selected.add(entry.id));
  render();
}

async function handleDeleteOne(e) {
  const id = e.target.dataset.id;
  if (!id) return;
  try {
    await capturedDelete([id]);
    selected.delete(id);
    await refresh();
  } catch (err) {
    showAlert(`Delete failed: ${err?.message ?? err}`, "error");
  }
}

async function handleSkipOne(e) {
  const id = e.target.dataset.id;
  if (!id) return;
  try {
    await capturedUpdateStatus([id], "skipped");
    selected.delete(id);
    await refresh();
  } catch (err) {
    showAlert(`Couldn't skip: ${err?.message ?? err}`, "error");
  }
}

async function handleDelete() {
  if (selected.size === 0) return;
  const ids = Array.from(selected);
  try {
    await capturedDelete(ids);
    selected.clear();
    await refresh();
    showAlert(`Deleted ${ids.length} entries.`, "success");
  } catch (err) {
    showAlert(`Delete failed: ${err?.message ?? err}`, "error");
  }
}

async function handleUpload() {
  if (selected.size === 0) return;
  const ids = Array.from(selected);
  const idSet = new Set(ids);
  const items = all
    .filter((e) => idSet.has(e.id) && e.status === "local")
    .map((e) => ({
      platform: e.platform,
      handle: e.handle,
      profileUrl: e.profileUrl,
      signalSummary: buildSignalSummary(e),
      signalData: {
        source: e.source,
        hashtag: e.hashtag ?? null,
        post_url: e.postUrl ?? null,
        captured_at: new Date(e.capturedAt).toISOString(),
        session_id: e.sessionId ?? null,
      },
    }));

  if (items.length === 0) {
    showAlert("Nothing uploadable in selection.", "error");
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading…";
  try {
    const res = await bulkUploadProspects(items);
    await capturedUpdateStatus(ids, "uploaded");
    selected.clear();
    await refresh();
    showAlert(
      `Uploaded ${res?.inserted ?? 0} new · ${res?.updated ?? 0} already in Pulse · ${res?.skipped ?? 0} skipped.`,
      "success"
    );
  } catch (err) {
    showAlert(`Upload failed: ${err?.message ?? err}`, "error");
  } finally {
    updateActionBar();
  }
}

function handleExport() {
  const entries = visibleEntries();
  if (entries.length === 0) {
    showAlert("Nothing to export in this view.", "error");
    return;
  }
  const header = [
    "platform",
    "handle",
    "profile_url",
    "hashtag",
    "post_url",
    "captured_at",
    "source",
    "status",
  ];
  const rows = entries.map((e) =>
    header
      .map((col) => csvCell(e[toCamel(col)] ?? csvFallback(col, e)))
      .join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pulse-captured-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function toCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function csvFallback(col, e) {
  if (col === "captured_at") return new Date(e.capturedAt).toISOString();
  return "";
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildSignalSummary(entry) {
  const parts = [];
  if (entry.hashtag) parts.push(`#${entry.hashtag}`);
  parts.push(
    entry.source === "scheduled" ? "scheduled crawl" : "captured from IG feed"
  );
  parts.push(new Date(entry.capturedAt).toLocaleDateString());
  return parts.join(" · ");
}

function formatAge(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showAlert(message, kind = "success") {
  alertEl.hidden = false;
  alertEl.className = `alert ${kind}`;
  alertEl.textContent = message;
  setTimeout(() => {
    alertEl.hidden = true;
  }, 4500);
}
