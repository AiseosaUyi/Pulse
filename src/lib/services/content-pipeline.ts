// Content Pipeline read paths. RLS-scoped — every query goes through
// the user's server client, so cross-tenant access is rejected
// automatically. The list query joins memberships + content_types
// once to avoid N+1 on render.

import { createClient } from "@/lib/supabase/server";
import { publicUrlFor } from "@/lib/storage/save-asset";
import type {
  ContentItem,
  ContentItemFilters,
  ContentItemWithDisplay,
  ContentSection,
  ContentType,
} from "@/lib/types/content-pipeline";

interface ItemRow {
  id: string;
  tenant_slug: string;
  section_slug: string;
  title: string;
  content_type_slug: string | null;
  status: ContentItem["status"];
  platforms: string[];
  scheduled_at: string | null;
  posted_at: string | null;
  posted_url: string | null;
  assigned_to: string | null;
  uploaded_by: string | null;
  storage_provider: ContentItem["storageProvider"];
  storage_key: string | null;
  storage_url: string | null;
  drive_file_id: string | null;
  drive_mime_type: string | null;
  drive_size_bytes: number | null;
  drive_web_view_link: string | null;
  drive_status: ContentItem["driveStatus"];
  thumbnail_storage_key: string | null;
  thumbnail_cached_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: ItemRow): ContentItem {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    sectionSlug: row.section_slug,
    title: row.title,
    contentTypeSlug: row.content_type_slug,
    status: row.status,
    platforms: row.platforms as ContentItem["platforms"],
    scheduledAt: row.scheduled_at,
    postedAt: row.posted_at,
    postedUrl: row.posted_url,
    assignedTo: row.assigned_to,
    uploadedBy: row.uploaded_by,
    storageProvider: row.storage_provider ?? "drive",
    storageKey: row.storage_key,
    storageUrl: row.storage_url,
    driveFileId: row.drive_file_id,
    driveMimeType: row.drive_mime_type,
    driveSizeBytes: row.drive_size_bytes,
    driveWebViewLink: row.drive_web_view_link,
    driveStatus: row.drive_status,
    thumbnailStorageKey: row.thumbnail_storage_key,
    thumbnailCachedAt: row.thumbnail_cached_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ProfileLite {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

function profileLabel(p: ProfileLite | undefined | null): string | null {
  if (!p) return null;
  return p.display_name ?? p.username ?? null;
}

function firstName(label: string | null): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * List content items with filters + cursor pagination. Single query
 * joining content_types for the label and profiles for the assignee/
 * uploader display names. Avoids N+1 on render.
 */
export async function listContentItems(
  tenantSlug: string,
  filters: ContentItemFilters = {}
): Promise<{ items: ContentItemWithDisplay[]; nextCursor: ContentItemFilters["cursor"] | null }> {
  const supabase = await createClient();
  const limit = Math.min(filters.limit ?? 50, 100);

  let q = supabase
    .from("content_items")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1); // +1 to detect next-cursor

  if (filters.sectionSlug) q = q.eq("section_slug", filters.sectionSlug);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.contentTypeSlug)
    q = q.eq("content_type_slug", filters.contentTypeSlug);
  if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters.platform) q = q.contains("platforms", [filters.platform]);
  if (filters.scheduledFrom)
    q = q.gte("scheduled_at", filters.scheduledFrom);
  if (filters.scheduledTo) q = q.lte("scheduled_at", filters.scheduledTo);

  // Cursor pagination — created_at, id strictly less than the cursor
  if (filters.cursor) {
    q = q.or(
      `created_at.lt.${filters.cursor.createdAt},and(created_at.eq.${filters.cursor.createdAt},id.lt.${filters.cursor.id})`
    );
  }

  const { data, error } = await q;
  if (error || !data) {
    return { items: [], nextCursor: null };
  }

  const rows = data as ItemRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Hydrate profile names + content type labels in two cheap follow-up
  // queries. Faster than a complex multi-FK join for this size.
  const userIds = Array.from(
    new Set(
      page
        .flatMap((r) => [r.assigned_to, r.uploaded_by])
        .filter((v): v is string => Boolean(v))
    )
  );
  const typeSlugs = Array.from(
    new Set(
      page
        .map((r) => r.content_type_slug)
        .filter((v): v is string => Boolean(v))
    )
  );

  const [profilesRes, typesRes] = await Promise.all([
    userIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", userIds)
      : Promise.resolve({ data: [] as ProfileLite[] }),
    typeSlugs.length > 0
      ? supabase
          .from("content_types")
          .select("slug, label")
          .eq("tenant_slug", tenantSlug)
          .in("slug", typeSlugs)
      : Promise.resolve({ data: [] as Array<{ slug: string; label: string }> }),
  ]);

  const profileMap = new Map(
    (((profilesRes.data ?? []) as ProfileLite[]) || []).map((p) => [p.id, p])
  );
  const typeMap = new Map(
    (((typesRes.data ?? []) as Array<{ slug: string; label: string }>) || []).map(
      (t) => [t.slug, t.label]
    )
  );

  const items: ContentItemWithDisplay[] = page.map((r) => {
    const base = rowToItem(r);
    const assignedProfile = r.assigned_to
      ? profileMap.get(r.assigned_to) ?? null
      : null;
    return {
      ...base,
      contentTypeLabel: r.content_type_slug
        ? typeMap.get(r.content_type_slug) ?? null
        : null,
      assignedToName: profileLabel(assignedProfile),
      assignedToFirstName: firstName(profileLabel(assignedProfile)),
      assignedToAvatarUrl: assignedProfile?.avatar_url ?? null,
      uploadedByName: r.uploaded_by
        ? profileLabel(profileMap.get(r.uploaded_by))
        : null,
      thumbnailUrl: r.thumbnail_storage_key
        ? publicUrlFor(r.thumbnail_storage_key)
        : null,
    };
  });

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? { createdAt: last.created_at, id: last.id }
      : null;

  return { items, nextCursor };
}

export async function getContentItemById(
  tenantSlug: string,
  id: string
): Promise<ContentItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToItem(data as ItemRow);
}

export async function listContentSections(
  tenantSlug: string
): Promise<ContentSection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_sections")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("sort_order");
  if (error || !data) return [];
  return (
    data as Array<{
      tenant_slug: string;
      slug: string;
      label: string;
      drive_folder_id: string | null;
      sort_order: number;
    }>
  ).map((r) => ({
    tenantSlug: r.tenant_slug,
    slug: r.slug,
    label: r.label,
    driveFolderId: r.drive_folder_id,
    sortOrder: r.sort_order,
  }));
}

export async function listContentTypes(
  tenantSlug: string
): Promise<ContentType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_types")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("is_default", { ascending: false })
    .order("label");
  if (error || !data) return [];
  return (
    data as Array<{
      tenant_slug: string;
      slug: string;
      label: string;
      is_default: boolean;
      created_by: string | null;
    }>
  ).map((r) => ({
    tenantSlug: r.tenant_slug,
    slug: r.slug,
    label: r.label,
    isDefault: r.is_default,
    createdBy: r.created_by,
  }));
}

export async function listAssignableMembers(
  tenantSlug: string
): Promise<Array<{ id: string; name: string; avatarUrl: string | null }>> {
  const supabase = await createClient();
  // Two-step query — direct join on auth.users / profiles via FK
  // hint is fragile across Supabase versions. Cheap to do as two
  // queries: memberships (small) → profiles (small).
  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_slug", tenantSlug);
  if (!memberships || memberships.length === 0) return [];
  const userIds = (memberships as Array<{ user_id: string }>).map(
    (m) => m.user_id
  );
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", userIds);
  const profileMap = new Map(
    ((profiles as Array<{
      id: string;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
    }> | null) ?? []).map((p) => [p.id, p])
  );
  return userIds
    .map((id) => {
      const p = profileMap.get(id);
      return {
        id,
        name: p?.display_name ?? p?.username ?? "Member",
        avatarUrl: p?.avatar_url ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
