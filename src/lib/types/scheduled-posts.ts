export type ScheduledPostStatus = "draft" | "scheduled" | "posted" | "dismissed";

export interface ScheduledPost {
  id: string;
  tenantSlug: string;
  briefId: string | null;
  platform: string;
  contentType: string | null;
  caption: string | null;
  bestTime: string | null;
  scheduledFor: string;
  status: ScheduledPostStatus;
  postedPostId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  briefTitle?: string | null;
}
