// Pure URL parser — extracted out of actions/drive-import.ts because
// Next/Turbopack rejects non-async exports from "use server" files.

export type DriveRef =
  | { kind: "file"; id: string }
  | { kind: "folder"; id: string };

/**
 * Parses a Drive share URL and extracts the file or folder ID.
 * Handles common formats:
 *   https://drive.google.com/file/d/<ID>/view
 *   https://drive.google.com/drive/folders/<ID>
 *   https://drive.google.com/open?id=<ID>
 */
export function parseDriveShareUrl(raw: string): DriveRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  const fileMatch = /\/file\/d\/([^/]+)/.exec(url.pathname);
  if (fileMatch) return { kind: "file", id: fileMatch[1] };

  const folderMatch = /\/drive\/folders\/([^/?]+)/.exec(url.pathname);
  if (folderMatch) return { kind: "folder", id: folderMatch[1] };

  const idParam = url.searchParams.get("id");
  if (idParam) return { kind: "file", id: idParam };

  return null;
}
