// "Your queue" morning email: one short note per teammate with what is
// waiting on them. Internal only (teammates, never leads or customers).
// Pure: no I/O, every dynamic value goes through escapeHtml.

export type NudgeItemKind = "reply" | "follow_up" | "decision";

export interface NudgeOldestItem {
  kind: NudgeItemKind;
  label: string;
  ageDays: number;
}

export interface QueueNudgeEmailInput {
  name: string;
  tenantName: string;
  replies: number;
  followUps: number;
  decisions: number;
  /** Oldest first, at most 5 are shown. */
  oldest: NudgeOldestItem[];
  /** Stale items archived by this run. Shown only when above 0. */
  archivedCount: number;
  dashboardUrl: string;
}

const KIND_LABEL: Record<NudgeItemKind, string> = {
  reply: "Reply",
  follow_up: "Follow-up",
  decision: "Decision",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatAge(days: number): string {
  if (days <= 0) return "today";
  return plural(days, "day", "days");
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

export function queueNudgeTotal(input: Pick<QueueNudgeEmailInput, "replies" | "followUps" | "decisions">): number {
  return input.replies + input.followUps + input.decisions;
}

export function queueNudgeSubject(input: QueueNudgeEmailInput): string {
  const total = queueNudgeTotal(input);
  return `Your queue: ${plural(total, "item", "items")} waiting`;
}

export function buildQueueNudgeEmail(input: QueueNudgeEmailInput): string {
  const counts = [
    { n: input.replies, text: plural(input.replies, "reply waiting", "replies waiting") },
    { n: input.followUps, text: plural(input.followUps, "follow-up due", "follow-ups due") },
    { n: input.decisions, text: plural(input.decisions, "decision", "decisions") },
  ];

  const countsHtml = counts
    .map(
      (c) => `<td style="padding:10px 12px;background:#f9fafb;border-radius:8px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:${c.n > 0 ? "#111827" : "#9ca3af"};">${c.n}</div>
          <div style="font-size:12px;color:#6b7280;">${escapeHtml(c.text.replace(/^\d+ /, ""))}</div>
        </td>`
    )
    .join(`<td style="width:8px;"></td>`);

  const oldestHtml = input.oldest
    .slice(0, 5)
    .map(
      (item) => `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">
            <span style="font-size:11px;font-weight:600;color:#ad112c;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(KIND_LABEL[item.kind])}</span><br/>
            ${escapeHtml(truncate(item.label, 90))}
          </td>
          <td style="padding:8px 0 8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;text-align:right;white-space:nowrap;">${escapeHtml(formatAge(item.ageDays))}</td>
        </tr>`
    )
    .join("");

  const archivedHtml =
    input.archivedCount > 0
      ? `<p style="margin:20px 0 0;padding:12px 14px;background:#f9fafb;border-radius:6px;font-size:13px;color:#374151;">${escapeHtml(
          `${plural(input.archivedCount, "stale item", "stale items")} over 30 days ${input.archivedCount === 1 ? "was" : "were"} archived; find them under Archived.`
        )}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ad112c;padding:20px 28px;">
      <span style="color:#fff;font-size:16px;font-weight:900;letter-spacing:0.05em;">PULSE</span>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(input.tenantName)}</p>
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">Good morning, ${escapeHtml(input.name)}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;">Here is what is waiting on you today.</p>
      <table style="width:100%;border-collapse:separate;"><tr>${countsHtml}</tr></table>
      ${
        oldestHtml
          ? `<p style="margin:24px 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Oldest first</p>
      <table style="width:100%;border-collapse:collapse;">${oldestHtml}</table>`
          : ""
      }
      ${archivedHtml}
      <div style="margin-top:24px;">
        <a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#ad112c;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:600;">Open my queue</a>
      </div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">You get this because you are on the ${escapeHtml(input.tenantName)} team in Pulse.</p>
    </div>
  </div>
</body>
</html>`;
}
