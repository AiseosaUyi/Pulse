import { createClient } from "@/lib/supabase/server";
import type {
  BlogPostFeedbackRecord,
  BlogPostFeedbackStatus,
} from "@/lib/types/blog-posts";

interface Row {
  id: string;
  blog_post_id: string;
  tenant_slug: string;
  feedback_text: string | null;
  feedback_audio_path: string | null;
  transcription: string | null;
  source_version_id: string | null;
  resulting_version_id: string | null;
  status: BlogPostFeedbackStatus;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
}

function rowTo(row: Row): BlogPostFeedbackRecord {
  return {
    id: row.id,
    blogPostId: row.blog_post_id,
    tenantSlug: row.tenant_slug,
    feedbackText: row.feedback_text,
    feedbackAudioPath: row.feedback_audio_path,
    transcription: row.transcription,
    sourceVersionId: row.source_version_id,
    resultingVersionId: row.resulting_version_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export async function listBlogPostFeedback(
  tenantSlug: string,
  blogPostId: string,
  limit = 50
): Promise<BlogPostFeedbackRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_post_feedback")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}
