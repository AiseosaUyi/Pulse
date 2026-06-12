import { createClient } from "@/lib/supabase/server";
import type { AuthorRecord } from "@/lib/types/authors";

interface AuthorRow {
  id: string;
  tenant_slug: string;
  name: string;
  title: string | null;
  bio: string | null;
  image_url: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: AuthorRow): AuthorRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    title: row.title,
    bio: row.bio,
    imageUrl: row.image_url,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAuthors(tenantSlug: string): Promise<AuthorRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authors")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("name", { ascending: true });
  if (error || !data) return [];
  return (data as AuthorRow[]).map(rowTo);
}
