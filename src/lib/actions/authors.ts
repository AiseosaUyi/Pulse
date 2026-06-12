"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { rewriteAuthorBio } from "@/lib/ai/rewrite-author-bio";
import type { AuthorRecord } from "@/lib/types/authors";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface AuthorInput {
  name: string;
  title?: string | null;
  bio?: string | null;
  imageUrl?: string | null;
  url?: string | null;
}

function rowToRecord(row: Record<string, unknown>): AuthorRecord {
  return {
    id: String(row.id),
    tenantSlug: String(row.tenant_slug),
    name: String(row.name),
    title: (row.title as string) ?? null,
    bio: (row.bio as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    url: (row.url as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createAuthor(
  input: AuthorInput
): Promise<ActionResult<{ author: AuthorRecord }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };
  const name = input.name.trim();
  if (!name) return { success: false, error: "Author name is required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authors")
    .insert({
      tenant_slug: tenant.slug,
      name,
      title: input.title?.trim() || null,
      bio: input.bio?.trim() || null,
      image_url: input.imageUrl || null,
      url: input.url?.trim() || null,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { success: false, error: "An author with that name already exists" };
    }
    return { success: false, error: error?.message ?? "Could not create author" };
  }
  revalidatePath("/seo-tracker/blog-writer/[id]", "page");
  return { success: true, author: rowToRecord(data) };
}

export async function updateAuthor(
  id: string,
  input: AuthorInput
): Promise<ActionResult<{ author: AuthorRecord }>> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authors")
    .update({
      name: input.name.trim(),
      title: input.title?.trim() || null,
      bio: input.bio?.trim() || null,
      image_url: input.imageUrl || null,
      url: input.url?.trim() || null,
    })
    .eq("id", id)
    .eq("tenant_slug", tenant.slug)
    .select("*")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Could not update author" };
  }
  return { success: true, author: rowToRecord(data) };
}

export async function deleteAuthor(id: string): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("authors")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenant.slug);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// AI-write an authority/E-E-A-T bio from a few facts + the brand positioning.
// Returned for preview/edit in the create-author modal before saving.
export async function generateAuthorBio(input: {
  name: string;
  title?: string | null;
  facts?: string | null;
}): Promise<ActionResult<{ bio: string }>> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };
  if (!input.name.trim()) {
    return { success: false, error: "Enter the author's name first" };
  }
  try {
    const { bio } = await rewriteAuthorBio({
      tenantSlug: tenant.slug,
      name: input.name.trim(),
      title: input.title,
      facts: input.facts,
    });
    return { success: true, bio };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Bio generation failed",
    };
  }
}
