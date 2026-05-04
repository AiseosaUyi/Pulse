import { createComposioClient } from "@/lib/composio/client";
import {
  type ResolvedConnection,
  userIdFor,
} from "@/lib/composio/resolve-alias";

// Thin typed wrappers around composio.tools.execute() for the specific
// tool slugs Pulse uses. Each function takes a resolved connection (so the
// caller has already gone through resolveActiveConnection) and returns
// shaped data instead of the raw Composio envelope.
//
// The execute response shape: { successful: boolean, data: unknown, error: string|null }
// We treat `successful=false` as a thrown error so callers can use plain
// try/catch instead of branching on the envelope.

interface ExecuteResult {
  successful: boolean;
  data: unknown;
  error?: string | null;
}

async function exec(
  slug: string,
  conn: ResolvedConnection,
  args: Record<string, unknown>
): Promise<unknown> {
  const composio = createComposioClient();
  const result = (await composio.tools.execute(slug, {
    userId: userIdFor(conn),
    arguments: args,
  })) as ExecuteResult;

  if (!result.successful) {
    throw new Error(
      `Composio tool ${slug} failed: ${result.error ?? "unknown error"}`
    );
  }
  return result.data;
}

// ───────────────────────────── Instagram ─────────────────────────────

export interface IgComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string;
  parentId: string | null;
  mediaId: string;
}

export async function getInstagramRecentMedia(
  conn: ResolvedConnection,
  limit = 25
): Promise<Array<{ id: string; permalink?: string; timestamp?: string }>> {
  const data = (await exec("INSTAGRAM_GET_IG_USER_MEDIA", conn, {
    limit,
  })) as { data?: Array<{ id: string; permalink?: string; timestamp?: string }> };
  return data.data ?? [];
}

export async function getInstagramMediaComments(
  conn: ResolvedConnection,
  mediaId: string
): Promise<IgComment[]> {
  const data = (await exec("INSTAGRAM_GET_IG_MEDIA_COMMENTS", conn, {
    ig_media_id: mediaId,
  })) as {
    data?: Array<{
      id: string;
      text?: string;
      username?: string;
      timestamp?: string;
      parent_id?: string;
    }>;
  };
  return (data.data ?? []).map((c) => ({
    id: c.id,
    text: c.text ?? "",
    username: c.username ?? null,
    timestamp: c.timestamp ?? new Date().toISOString(),
    parentId: c.parent_id ?? null,
    mediaId,
  }));
}

export async function replyToInstagramComment(
  conn: ResolvedConnection,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const data = (await exec("INSTAGRAM_POST_IG_COMMENT_REPLIES", conn, {
    ig_comment_id: commentId,
    message,
    graph_api_version: "v21.0",
  })) as { data?: { id?: string } };
  return { id: data.data?.id ?? "" };
}

export async function deleteInstagramComment(
  conn: ResolvedConnection,
  commentId: string
): Promise<void> {
  await exec("INSTAGRAM_DELETE_COMMENT", conn, { ig_comment_id: commentId });
}

export interface IgConversation {
  id: string;
  participantHandle: string | null;
  participantId: string | null;
  updatedAt: string;
}

export async function listInstagramConversations(
  conn: ResolvedConnection
): Promise<IgConversation[]> {
  const data = (await exec("INSTAGRAM_LIST_ALL_CONVERSATIONS", conn, {})) as {
    data?: Array<{
      id: string;
      participants?: { data?: Array<{ id: string; username?: string }> };
      updated_time?: string;
    }>;
  };
  return (data.data ?? []).map((c) => {
    const other = c.participants?.data?.[0];
    return {
      id: c.id,
      participantHandle: other?.username ?? null,
      participantId: other?.id ?? null,
      updatedAt: c.updated_time ?? new Date().toISOString(),
    };
  });
}

export interface IgMessage {
  id: string;
  fromId: string;
  fromHandle: string | null;
  message: string;
  createdAt: string;
}

export async function listInstagramMessages(
  conn: ResolvedConnection,
  conversationId: string
): Promise<IgMessage[]> {
  const data = (await exec("INSTAGRAM_LIST_ALL_MESSAGES", conn, {
    conversation_id: conversationId,
  })) as {
    data?: Array<{
      id: string;
      from?: { id: string; username?: string };
      message?: string;
      created_time?: string;
    }>;
  };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    fromId: m.from?.id ?? "",
    fromHandle: m.from?.username ?? null,
    message: m.message ?? "",
    createdAt: m.created_time ?? new Date().toISOString(),
  }));
}

export async function sendInstagramDM(
  conn: ResolvedConnection,
  recipientId: string,
  message: string
): Promise<{ messageId: string }> {
  const data = (await exec("INSTAGRAM_SEND_TEXT_MESSAGE", conn, {
    recipient_id: recipientId,
    text: message,
  })) as { data?: { message_id?: string } };
  return { messageId: data.data?.message_id ?? "" };
}

export async function markInstagramConversationSeen(
  conn: ResolvedConnection,
  recipientId: string
): Promise<void> {
  await exec("INSTAGRAM_MARK_SEEN", conn, { recipient_id: recipientId });
}

export async function publishInstagramSinglePost(
  conn: ResolvedConnection,
  params: {
    mediaUrl: string;
    caption?: string;
    mediaType: "image" | "video" | "reel";
  }
): Promise<{ mediaId: string }> {
  // Step 1: create container
  const containerArgs: Record<string, unknown> = { caption: params.caption };
  if (params.mediaType === "image") {
    containerArgs.image_url = params.mediaUrl;
  } else {
    containerArgs.media_type = params.mediaType === "reel" ? "REELS" : "VIDEO";
    containerArgs.video_url = params.mediaUrl;
  }
  const created = (await exec(
    "INSTAGRAM_POST_IG_USER_MEDIA",
    conn,
    containerArgs
  )) as { data?: { id?: string } };
  const containerId = created.data?.id;
  if (!containerId) throw new Error("Container creation returned no id");

  // Step 2: publish
  const published = (await exec("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", conn, {
    creation_id: containerId,
  })) as { data?: { id?: string } };
  return { mediaId: published.data?.id ?? containerId };
}

export async function getInstagramMediaInsights(
  conn: ResolvedConnection,
  mediaId: string
): Promise<{
  reach?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}> {
  const data = (await exec("INSTAGRAM_GET_IG_MEDIA_INSIGHTS", conn, {
    ig_media_id: mediaId,
  })) as { data?: Array<{ name: string; values: Array<{ value: number }> }> };
  const out: Record<string, number> = {};
  for (const m of data.data ?? []) {
    out[m.name] = m.values?.[0]?.value ?? 0;
  }
  return {
    reach: out.reach,
    impressions: out.impressions,
    likes: out.likes,
    comments: out.comments,
    shares: out.shares,
    saves: out.saved,
  };
}

export async function getInstagramUserInfo(
  conn: ResolvedConnection
): Promise<{ id: string; username: string; name?: string }> {
  const data = (await exec("INSTAGRAM_GET_USER_INFO", conn, {})) as {
    data?: { id?: string; username?: string; name?: string };
  };
  return {
    id: data.data?.id ?? "",
    username: data.data?.username ?? "",
    name: data.data?.name,
  };
}

// ───────────────────────────── LinkedIn ──────────────────────────────

export async function publishLinkedInTextPost(
  conn: ResolvedConnection,
  text: string
): Promise<{ postUrn: string }> {
  const data = (await exec("LINKEDIN_CREATE_LINKED_IN_POST", conn, {
    commentary: text,
    visibility: "PUBLIC",
    lifecycleState: "PUBLISHED",
  })) as { data?: { id?: string } };
  return { postUrn: data.data?.id ?? "" };
}

export async function publishLinkedInArticleShare(
  conn: ResolvedConnection,
  url: string,
  commentary?: string
): Promise<{ postUrn: string }> {
  const data = (await exec("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE", conn, {
    article_url: url,
    commentary: commentary ?? "",
    visibility: "PUBLIC",
  })) as { data?: { id?: string } };
  return { postUrn: data.data?.id ?? "" };
}

export async function commentOnLinkedInPost(
  conn: ResolvedConnection,
  postUrn: string,
  message: string
): Promise<{ commentUrn: string }> {
  const data = (await exec("LINKEDIN_CREATE_COMMENT_ON_POST", conn, {
    post_urn: postUrn,
    message,
  })) as { data?: { id?: string } };
  return { commentUrn: data.data?.id ?? "" };
}

export async function getLinkedInShareStats(
  conn: ResolvedConnection,
  postUrn: string
): Promise<{ likes?: number; comments?: number; shares?: number }> {
  const data = (await exec("LINKEDIN_GET_SHARE_STATS", conn, {
    post_urn: postUrn,
  })) as {
    data?: {
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
    };
  };
  return {
    likes: data.data?.likeCount,
    comments: data.data?.commentCount,
    shares: data.data?.shareCount,
  };
}

export async function getLinkedInProfile(
  conn: ResolvedConnection
): Promise<{ id: string; localizedFirstName?: string; localizedLastName?: string }> {
  const data = (await exec("LINKEDIN_GET_MY_INFO", conn, {})) as {
    data?: {
      id?: string;
      localizedFirstName?: string;
      localizedLastName?: string;
    };
  };
  return {
    id: data.data?.id ?? "",
    localizedFirstName: data.data?.localizedFirstName,
    localizedLastName: data.data?.localizedLastName,
  };
}

// ────────────────────────────── TikTok ───────────────────────────────

export async function publishTikTokVideo(
  conn: ResolvedConnection,
  params: { videoUrl: string; caption?: string }
): Promise<{ publishId: string }> {
  const uploaded = (await exec("TIKTOK_UPLOAD_VIDEO", conn, {
    video_url: params.videoUrl,
    title: params.caption ?? "",
  })) as { data?: { publish_id?: string; video_id?: string } };
  const publishId =
    uploaded.data?.publish_id ?? uploaded.data?.video_id ?? "";
  if (!publishId) throw new Error("TikTok upload returned no publish id");

  // Some flows require an explicit publish call after upload.
  await exec("TIKTOK_PUBLISH_VIDEO", conn, {
    publish_id: publishId,
    title: params.caption ?? "",
  }).catch(() => {
    // If TIKTOK_PUBLISH_VIDEO isn't needed (auto-published), swallow.
  });

  return { publishId };
}

export async function getTikTokPublishStatus(
  conn: ResolvedConnection,
  publishId: string
): Promise<{ status: string; videoId?: string; error?: string }> {
  const data = (await exec("TIKTOK_FETCH_PUBLISH_STATUS", conn, {
    publish_id: publishId,
  })) as { data?: { status?: string; video_id?: string; error?: string } };
  return {
    status: data.data?.status ?? "unknown",
    videoId: data.data?.video_id,
    error: data.data?.error,
  };
}

export async function getTikTokUserBasicInfo(
  conn: ResolvedConnection
): Promise<{
  openId: string;
  displayName?: string;
  username?: string;
  followerCount?: number;
}> {
  const data = (await exec("TIKTOK_GET_USER_BASIC_INFO", conn, {})) as {
    data?: {
      open_id?: string;
      display_name?: string;
      username?: string;
      follower_count?: number;
    };
  };
  return {
    openId: data.data?.open_id ?? "",
    displayName: data.data?.display_name,
    username: data.data?.username,
    followerCount: data.data?.follower_count,
  };
}

export async function listTikTokVideos(
  conn: ResolvedConnection,
  limit = 20
): Promise<
  Array<{
    id: string;
    title?: string;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    createTime?: string;
  }>
> {
  const data = (await exec("TIKTOK_LIST_VIDEOS", conn, {
    max_count: limit,
  })) as {
    data?: {
      videos?: Array<{
        id: string;
        title?: string;
        view_count?: number;
        like_count?: number;
        comment_count?: number;
        share_count?: number;
        create_time?: number;
      }>;
    };
  };
  return (data.data?.videos ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    viewCount: v.view_count,
    likeCount: v.like_count,
    commentCount: v.comment_count,
    shareCount: v.share_count,
    createTime: v.create_time
      ? new Date(v.create_time * 1000).toISOString()
      : undefined,
  }));
}
