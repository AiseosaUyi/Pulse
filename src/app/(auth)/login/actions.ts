"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    redirect("/login?error=" + encodeURIComponent("Email and password required"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  // Ensure the tenant cookie points to a tenant the user belongs to.
  const cookieStore = await cookies();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: memberships } = user
    ? await supabase
        .from("memberships")
        .select("tenant_slug")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
    : { data: [] };

  const slugs = (memberships ?? []).map((m) => m.tenant_slug);
  const currentCookie = cookieStore.get("tenant")?.value;
  if (slugs.length > 0 && (!currentCookie || !slugs.includes(currentCookie))) {
    cookieStore.set("tenant", slugs[0], {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  redirect(next.startsWith("/") ? next : "/dashboard");
}
