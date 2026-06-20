// Content Pipeline types. Asset-shaped (not post-shaped) — see
// migration 041 and the engineering plan for the full rationale.
// Brief shape mirrors src/lib/types/scheduled-posts.ts.

export type ContentItemStatus =
  | "not_posted"
  | "scheduled"
  | "posted"
  | "archived"
  | "draft";

export type ContentItemDriveStatus = "ok" | "missing" | "permission_lost";

// Pulse's canonical platform set. Validated at the action layer (zod);
// not enforced by the DB so the list can grow without a migration.
export type ContentPlatform =
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "x"
  | "facebook"
  | "whatsapp"
  | "email";

export const CONTENT_PLATFORMS: ContentPlatform[] = [
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "facebook",
  "whatsapp",
  "email",
];

export const DEFAULT_CONTENT_TYPES: ReadonlyArray<{
  slug: string;
  label: string;
}> = [
  { slug: "meme", label: "Meme" },
  { slug: "ugc", label: "UGC" },
  { slug: "promo", label: "Promo" },
  { slug: "testimonial", label: "Testimonial" },
  { slug: "product", label: "Product" },
  { slug: "event", label: "Event" },
  { slug: "educational", label: "Educational" },
];

export const DEFAULT_CONTENT_SECTIONS: ReadonlyArray<{
  slug: string;
  label: string;
  sortOrder: number;
}> = [
  // Single section for MVP — the pipeline of finished pieces ready
  // to post. Schema supports more sections per tenant; we just don't
  // seed them yet. Add via a future settings UI if teams want
  // separate buckets (e.g. raw clips, evergreen, etc).
  { slug: "posts", label: "Posts", sortOrder: 0 },
];

export interface ContentSection {
  tenantSlug: string;
  slug: string;
  label: string;
  driveFolderId: string | null;
  sortOrder: number;
}

export interface ContentType {
  tenantSlug: string;
  slug: string;
  label: string;
  isDefault: boolean;
  createdBy: string | null;
}

export type ContentItemStorageProvider = "drive" | "r2";

export interface ContentItem {
  id: string;
  tenantSlug: string;
  sectionSlug: string;
  title: string;
  contentTypeSlug: string | null;
  status: ContentItemStatus;
  platforms: ContentPlatform[];
  scheduledAt: string | null;
  postedAt: string | null;
  postedUrl: string | null;
  assignedTo: string | null;
  uploadedBy: string | null;
  // Storage: 'r2' for new uploads, 'drive' for legacy items.
  storageProvider: ContentItemStorageProvider;
  storageKey: string | null;       // R2 object key (r2 items)
  storageUrl: string | null;       // R2 public URL (r2 items)
  driveFileId: string | null;      // Google Drive file ID (drive items)
  driveMimeType: string | null;
  driveSizeBytes: number | null;
  driveWebViewLink: string | null; // Direct link to view in Drive (drive items)
  driveStatus: ContentItemDriveStatus;
  thumbnailStorageKey: string | null;
  thumbnailCachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Display-augmented shape — what the table renders. Pulled in via
// the same query that fetches the row (joined against memberships +
// content_types so we don't N+1 on render).
export interface ContentItemWithDisplay extends ContentItem {
  contentTypeLabel: string | null;
  assignedToName: string | null;
  assignedToFirstName: string | null;
  assignedToAvatarUrl: string | null;
  uploadedByName: string | null;
  thumbnailUrl: string | null;
}

export interface ContentItemFilters {
  sectionSlug?: string;
  status?: ContentItemStatus;
  platform?: ContentPlatform;
  contentTypeSlug?: string;
  assignedTo?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  // Cursor pagination — pass the createdAt+id of the last row from
  // the prior page. See listContentItems().
  cursor?: { createdAt: string; id: string };
  limit?: number;
}

// Drive connection shape. We never expose raw refresh_token to the
// client; this is the server-side view.
export interface TenantDriveConnection {
  tenantSlug: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  scope: string;
  rootFolderId: string | null;
  connectedByUserId: string | null;
  status: "active" | "revoked" | "error";
  lastError: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface ContentUploadSession {
  id: string;
  tenantSlug: string;
  userId: string;
  storageProvider: ContentItemStorageProvider;
  driveResumableUri: string | null; // Drive sessions only
  r2Key: string | null;             // R2 sessions only
  filename: string;
  sizeBytes: number;
  sectionSlug: string;
  status: "pending" | "complete" | "abandoned";
  createdAt: string;
  finalizedAt: string | null;
}

export interface DriveImportJob {
  id: string;
  tenantSlug: string;
  sourceUrl: string;
  kind: "file" | "folder";
  status: "pending" | "running" | "complete" | "failed";
  importedCount: number;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
}
