import "server-only";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

interface SendEmailInput {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent?: string;
  replyTo?: { email: string; name?: string };
  tags?: string[];
}

export async function sendBrevoEmail(input: SendEmailInput): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "BREVO_API_KEY is not set" };

  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "noreply@gruve.events";
  const fromName = process.env.BREVO_FROM_NAME ?? "PULSE";

  const body = {
    sender: { email: fromEmail, name: fromName },
    to: [input.to],
    subject: input.subject,
    htmlContent: input.htmlContent,
    ...(input.textContent ? { textContent: input.textContent } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  };

  try {
    const res = await fetch(BREVO_API, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }

    if (!res.ok) {
      const detail = (json.message as string) || (json.code as string) || raw || `HTTP ${res.status}`;
      console.error("[brevo] send failed", { status: res.status, from: fromEmail, to: input.to.email, detail });
      return { ok: false, error: `Brevo ${res.status}: ${detail}` };
    }
    const messageId = (json.messageId as string) ?? "";
    console.log("[brevo] sent", { from: fromEmail, to: input.to.email, messageId });
    return { ok: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[brevo] fetch error", msg);
    return { ok: false, error: msg };
  }
}

interface InviteEmailInput {
  to: string;
  tenantName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

export function buildInviteEmail({ tenantName, inviterName, role, acceptUrl }: InviteEmailInput): { subject: string; html: string; text: string } {
  const subject = `${inviterName} invited you to join ${tenantName} on PULSE`;
  const previewText = `Join ${tenantName} as a ${role} on PULSE.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(subject)}</title>
<style>
  @media (max-width: 480px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 24px !important; line-height: 32px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f2;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
          <tr>
            <td style="padding:0 0 24px 0;">
              <span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:900;font-size:28px;letter-spacing:-0.5px;color:#ad112c;">PULSE</span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:6px;background:linear-gradient(135deg,#ad112c 0%,#7a0a1f 100%);"></td>
                </tr>
                <tr>
                  <td class="px" style="padding:40px 48px 8px 48px;">
                    <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#ad112c;">You're invited</p>
                    <h1 class="h1" style="margin:0 0 16px 0;font-size:28px;line-height:36px;font-weight:800;letter-spacing:-0.4px;color:#0d0d0d;">
                      Join ${escapeHtml(tenantName)} on PULSE
                    </h1>
                    <p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#3f3f3f;">
                      <strong style="color:#0d0d0d;">${escapeHtml(inviterName)}</strong> has invited you to collaborate on <strong style="color:#0d0d0d;">${escapeHtml(tenantName)}</strong> as a <strong style="color:#0d0d0d;">${escapeHtml(role)}</strong>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:0 48px 8px 48px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf8f4;border:1px solid #ece7dd;border-radius:12px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <p style="margin:0 0 4px 0;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#7a7a7a;">Organization</p>
                          <p style="margin:0;font-size:16px;font-weight:700;color:#0d0d0d;">${escapeHtml(tenantName)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:24px 48px 8px 48px;" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="border-radius:999px;background:#ad112c;">
                          <a href="${acceptUrl}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;letter-spacing:0.2px;">Accept invitation</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:16px 48px 0 48px;">
                    <p style="margin:0;font-size:13px;line-height:20px;color:#7a7a7a;text-align:center;">
                      Or paste this link into your browser:<br/>
                      <a href="${acceptUrl}" style="color:#ad112c;text-decoration:none;word-break:break-all;">${escapeHtml(acceptUrl)}</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:32px 48px 40px 48px;">
                    <div style="height:1px;background:#ece7dd;margin-bottom:20px;"></div>
                    <p style="margin:0;font-size:12px;line-height:18px;color:#9a9a9a;">
                      This invitation will expire in 7 days. If you weren't expecting this email, you can safely ignore it.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 0 8px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9a9a9a;">
                Sent by PULSE — your marketing OS.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${inviterName} invited you to join ${tenantName} on PULSE as a ${role}.`,
    "",
    `Accept your invitation: ${acceptUrl}`,
    "",
    "This link expires in 7 days. If you weren't expecting this email, ignore it.",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
