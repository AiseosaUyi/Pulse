export interface WeeklyDigestEmailProps {
  tenantName: string;
  weekOf: string;
  narrative: string;
  wins: string[];
  drags: string[];
  nextWeekFocus: Array<{ title: string; why: string }>;
  aiCostUsd: number;
}

export function weeklyDigestHtml(p: WeeklyDigestEmailProps): string {
  const { tenantName, weekOf, narrative, wins, drags, nextWeekFocus, aiCostUsd } = p;

  const winsHtml = wins
    .map((w) => `<li style="margin-bottom:6px;">${esc(w)}</li>`)
    .join("");

  const dragsHtml =
    drags.length > 0
      ? drags.map((d) => `<li style="margin-bottom:6px;">${esc(d)}</li>`).join("")
      : `<li style="color:#888;">Nothing notable.</li>`;

  const focusHtml = nextWeekFocus
    .map(
      (f) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <p style="margin:0 0 4px;font-weight:600;color:#111;">${esc(f.title)}</p>
        <p style="margin:0;font-size:13px;color:#555;">${esc(f.why)}</p>
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr>
          <td style="background:#ad112c;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:.06em;color:#ffffff;">PULSE</p>
          </td>
        </tr>

        <!-- Title -->
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#999;">Weekly Business Review</p>
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111;">${esc(tenantName)}</h1>
            <p style="margin:0;font-size:13px;color:#888;">Week of ${esc(weekOf)}</p>
          </td>
        </tr>

        <!-- Narrative -->
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0;font-size:15px;line-height:1.65;color:#333;">${esc(narrative)}</p>
          </td>
        </tr>

        <!-- Wins -->
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#ad112c;">Wins</p>
            <ul style="margin:0;padding-left:18px;color:#333;font-size:14px;line-height:1.6;">${winsHtml}</ul>
          </td>
        </tr>

        <!-- Drags -->
        <tr>
          <td style="padding:0 32px 20px;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;">What slipped</p>
            <ul style="margin:0;padding-left:18px;color:#555;font-size:14px;line-height:1.6;">${dragsHtml}</ul>
          </td>
        </tr>

        <!-- Next week focus -->
        <tr>
          <td style="padding:0 32px 28px;">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#111;">This week's priorities</p>
            <table width="100%" cellpadding="0" cellspacing="0">${focusHtml}</table>
          </td>
        </tr>

        <!-- AI cost footer line -->
        <tr>
          <td style="padding:16px 32px;background:#fafaf9;border-top:1px solid #f0eeeb;">
            <p style="margin:0;font-size:12px;color:#999;">AI spend this week: <strong style="color:#555;">$${aiCostUsd.toFixed(2)}</strong></p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background:#fafaf9;border-top:1px solid #f0eeeb;">
            <p style="margin:0;font-size:11px;color:#bbb;text-align:center;">
              Sent by Pulse · <a href="https://pulse.gruve.events/settings/notifications" style="color:#bbb;">Manage preferences</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
