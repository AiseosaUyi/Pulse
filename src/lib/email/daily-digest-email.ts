export function dailyDigestHtml(params: {
  tenantName: string;
  date: string;
  scheduledToday: Array<{ platform: string; snippet: string }>;
  signalCount: number;
  topSignal: {
    competitor: string;
    description: string;
    composerUrl: string;
  } | null;
}): string {
  const { tenantName, date, scheduledToday, signalCount, topSignal } = params;

  const postsHtml =
    scheduledToday.length > 0
      ? scheduledToday
          .map(
            (p) =>
              `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:11px;font-weight:600;color:#ad112c;text-transform:uppercase;letter-spacing:0.05em;">${p.platform}</span>
                <br/><span style="font-size:13px;color:#374151;">${p.snippet}</span>
              </td></tr>`
          )
          .join("")
      : `<tr><td style="padding:12px 0;color:#6b7280;font-size:13px;">Nothing scheduled yet — <a href="https://pulse.gruve.events/composer" style="color:#ad112c;">draft a post</a></td></tr>`;

  const signalSection =
    signalCount > 0
      ? `<div style="background:#fff7f7;border-left:3px solid #ad112c;padding:14px 16px;border-radius:4px;margin:20px 0;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#ad112c;">What&apos;s moving</p>
          <p style="margin:0;font-size:13px;color:#374151;">${signalCount} new signal${signalCount !== 1 ? "s" : ""} in your Intel Feed since yesterday.</p>
          <a href="https://pulse.gruve.events/intel-feed" style="display:inline-block;margin-top:8px;font-size:12px;color:#ad112c;text-decoration:none;font-weight:600;">View Intel Feed →</a>
        </div>`
      : "";

  const yourMoveSection = topSignal
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;padding:14px 16px;border-radius:6px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Your move</p>
        <p style="margin:0 0 10px;font-size:13px;color:#374151;"><strong>${topSignal.competitor}</strong> ${topSignal.description}</p>
        <a href="${topSignal.composerUrl}" style="display:inline-block;background:#ad112c;color:#fff;padding:8px 16px;border-radius:20px;text-decoration:none;font-size:12px;font-weight:600;">Draft your response →</a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <!-- Header -->
    <div style="background:#ad112c;padding:20px 28px;">
      <span style="color:#fff;font-size:16px;font-weight:900;letter-spacing:0.05em;">PULSE</span>
    </div>
    <!-- Body -->
    <div style="padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">${date}</p>
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111827;">Good morning, ${tenantName}</h1>

      <!-- Today's posts -->
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Today&apos;s posts</p>
      <table style="width:100%;border-collapse:collapse;">${postsHtml}</table>

      ${signalSection}
      ${yourMoveSection}
    </div>
    <!-- Footer -->
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        <a href="https://pulse.gruve.events/dashboard" style="color:#ad112c;text-decoration:none;">Open Pulse</a>
        &nbsp;·&nbsp;
        <a href="https://pulse.gruve.events/settings/notifications" style="color:#9ca3af;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
