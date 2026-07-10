// Approval-link email (Part 3 of the /api/v1 + MCP build spec). Same
// inline-HTML-string convention as content-calendar-email.ts — no MJML/
// React-email step in this codebase, kept consistent rather than
// introducing a new templating approach for one email.

export function approvalRequestHtml(params: {
  targetLabel: string; // e.g. "Instagram post" or "Content brief"
  preview: string; // first ~200 chars of the content, plain text
  approveUrl: string;
}): string {
  const { targetLabel, preview, approveUrl } = params;
  const escapedPreview = preview
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ad112c;padding:20px 28px;">
      <p style="margin:0;color:#fff;font-size:13px;font-weight:600;">Needs your approval — ${targetLabel}</p>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.5;">${escapedPreview}${preview.length >= 200 ? "…" : ""}</p>
      <a href="${approveUrl}" style="display:inline-block;background:#ad112c;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:600;">Review on your phone →</a>
      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">This link expires in 72 hours and works once.</p>
    </div>
  </div>
</body>
</html>`;
}
