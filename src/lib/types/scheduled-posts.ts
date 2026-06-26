export type ScheduledPostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export interface ScheduledPost {
  id: string;
  tenantSlug: string;
  platform: string;
  content: string;
  scheduledFor: string;
  postedAt: string | null;
  platformPostUrl: string | null;
  status: ScheduledPostStatus;
  errorMessage: string | null;
  source: string;
  createdAt: string;
}
