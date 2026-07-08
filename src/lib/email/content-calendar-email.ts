const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pulse.gruve.events";

export function contentCalendarAssignmentHtml(params: {
  date: string;
  topicTitle: string;
  talkingPoints: string[];
  stale: boolean;
}): string {
  const { date, topicTitle, talkingPoints, stale } = params;
  const pointsHtml = talkingPoints
    .map((p) => `<li style="margin-bottom:6px;color:#374151;font-size:13px;">${p}</li>`)
    .join("");
  const staleBanner = stale
    ? `<div style="background:#fffbeb;border-left:3px solid #d97706;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:12px;color:#92400e;">This brief has been sitting a while — double-check it's still current before filming.</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ad112c;padding:20px 28px;">
      <p style="margin:0;color:#fff;font-size:13px;font-weight:600;">Today's assignment — ${date}</p>
    </div>
    <div style="padding:24px 28px;">
      ${staleBanner}
      <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">${topicTitle}</h2>
      <ul style="margin:0 0 16px;padding-left:18px;">${pointsHtml}</ul>
      <a href="${APP_URL}/content-calendar" style="display:inline-block;background:#ad112c;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:600;">Open in Pulse →</a>
    </div>
  </div>
</body>
</html>`;
}

export function contentCalendarEmptyQueueHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ad112c;padding:20px 28px;">
      <p style="margin:0;color:#fff;font-size:13px;font-weight:600;">Your content queue is empty</p>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;font-size:13px;color:#374151;">Nothing left in the queue — generate your next batch of topics whenever you have a free block.</p>
      <a href="${APP_URL}/content-calendar" style="display:inline-block;background:#ad112c;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:600;">Generate more →</a>
    </div>
  </div>
</body>
</html>`;
}
