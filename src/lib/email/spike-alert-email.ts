export function spikeAlertHtml(params: {
  tenantName: string;
  competitorName: string;
  platform: string;
  contentType: string;
  multiplier: number;
  summary: string;
  yourAngle: string;
  composerUrl: string;
}): string {
  const {
    tenantName,
    competitorName,
    platform,
    contentType,
    multiplier,
    summary,
    yourAngle,
    composerUrl,
  } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <!-- Header -->
    <div style="background:#ad112c;padding:20px 28px;display:flex;align-items:center;gap:12px;">
      <span style="color:#fff;font-size:16px;font-weight:900;letter-spacing:0.05em;">PULSE</span>
      <span style="color:#fca5a5;font-size:13px;font-weight:500;">⚡ Spike alert</span>
    </div>
    <!-- Body -->
    <div style="padding:28px;">
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">Hi ${tenantName},</p>

      <!-- Spike card -->
      <div style="background:#fff7f7;border:1px solid #fecaca;border-radius:6px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#ad112c;">
          ${competitorName} on ${platform}
        </p>
        <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#111827;">${multiplier.toFixed(1)}x avg engagement</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
          Their ${contentType}: ${summary}
        </p>
      </div>

      <!-- Your angle -->
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Your angle</p>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;background:#f9fafb;padding:14px;border-radius:6px;border-left:3px solid #ad112c;">
        ${yourAngle}
      </p>

      <a href="${composerUrl}" style="display:inline-block;background:#ad112c;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-size:14px;font-weight:600;">
        Draft this in Composer →
      </a>
    </div>
    <!-- Footer -->
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        <a href="https://pulse.gruve.events/intel-feed" style="color:#ad112c;text-decoration:none;">View Intel Feed</a>
        &nbsp;·&nbsp;
        <a href="https://pulse.gruve.events/settings/notifications" style="color:#9ca3af;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
