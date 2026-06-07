// Env-var PEM values get mangled in predictable ways depending on how
// they're pasted (Vercel dashboard, dotenv, CI): literal `\n` escapes
// instead of real newlines, surrounding quotes left in, CRLF line
// endings, or the whole key flattened onto one line. node:crypto and
// jose both need a well-formed PEM with the BEGIN/END markers on their
// own lines and the base64 body wrapped. Normalize all of those cases so
// the key parses regardless of how it was entered.
export function normalizePrivateKeyPem(
  raw: string | undefined
): string | undefined {
  if (!raw) return raw;
  let s = raw.trim();

  // Strip one layer of surrounding quotes if a quoted .env value leaked in.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }

  // Literal escape sequences → real newlines; normalize CRLF.
  s = s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\\r/g, "")
    .trim();

  // If it collapsed onto a single line, rebuild a valid PEM: markers on
  // their own lines, base64 body re-wrapped at 64 chars.
  if (!s.includes("\n") && s.includes("-----BEGIN")) {
    const m = s.match(/-----BEGIN ([^-]+)-----\s*([\s\S]*?)\s*-----END \1-----/);
    if (m) {
      const label = m[1].trim();
      const body = m[2].replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      s = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
    }
  }

  return s;
}
