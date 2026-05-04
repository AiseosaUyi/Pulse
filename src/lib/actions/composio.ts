"use server";

import { revalidatePath } from "next/cache";
import { createComposioClient, type Toolkit } from "@/lib/composio/client";
import {
  getInstagramUserInfo,
  getLinkedInProfile,
  getTikTokUserBasicInfo,
} from "@/lib/composio/executors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface InitiateInput {
  tenantSlug: string;
  toolkit: Toolkit;
  alias: string;
}

// Kicks off OAuth: returns a redirect URL the user opens to authorize.
// Inserts (or updates) a `pending` connected_accounts row tied to the
// returned Composio connection_id so we can flip it active once the
// callback completes.
export async function initiateComposioConnection(
  input: InitiateInput
): Promise<ActionResult<{ redirectUrl: string; connectionId: string }>> {
  const user = await requireUser();
  const supabase = await createClient();

  // Verify caller is owner/admin of the tenant — connecting external
  // auth modifies tenant credentials, not personal data.
  const { data: role } = await supabase
    .rpc("tenant_role", { p_slug: input.tenantSlug })
    .single<string>();
  if (role !== "owner" && role !== "admin") {
    return { success: false, error: "Only owners or admins can connect accounts" };
  }

  try {
    const composio = createComposioClient();
    const userId = input.alias;
    const connectionRequest = await composio.toolkits.authorize(
      userId,
      input.toolkit
    );

    const db = createAdminClient();
    await db.from("connected_accounts").upsert(
      {
        tenant_slug: input.tenantSlug,
        toolkit: input.toolkit,
        alias: input.alias,
        composio_connection_id: connectionRequest.id,
        composio_user_id: userId,
        status: "pending",
        created_by: user.id,
      },
      { onConflict: "tenant_slug,toolkit,alias" }
    );

    return {
      success: true,
      redirectUrl: connectionRequest.redirectUrl ?? "",
      connectionId: connectionRequest.id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to initiate connection",
    };
  }
}

// Polls Composio for the connection's final state. If active, populates
// user_handle + display_name from the toolkit's profile tool and flips
// the row to `active`.
export async function confirmComposioConnection(
  connectionId: string
): Promise<ActionResult<{ status: string }>> {
  await requireUser();

  try {
    const composio = createComposioClient();
    const account = await composio.connectedAccounts.waitForConnection(
      connectionId,
      30_000
    );

    const db = createAdminClient();
    const { data: row } = await db
      .from("connected_accounts")
      .select("id, tenant_slug, toolkit, alias, composio_user_id")
      .eq("composio_connection_id", connectionId)
      .maybeSingle();

    if (!row) {
      return { success: false, error: "Connection row not found in Pulse" };
    }

    // Best-effort profile fetch — non-fatal if the toolkit profile tool
    // fails so we still mark the row active when Composio says ACTIVE.
    let userHandle: string | null = null;
    let displayName: string | null = null;

    const conn = {
      id: row.id,
      alias: row.alias,
      composioConnectionId: connectionId,
      composioUserId: row.composio_user_id,
      userHandle: null,
      lastSyncedAt: null,
    };

    try {
      if (row.toolkit === "instagram") {
        const info = await getInstagramUserInfo(conn);
        userHandle = info.username;
        displayName = info.name ?? info.username;
      } else if (row.toolkit === "linkedin") {
        const profile = await getLinkedInProfile(conn);
        const name = [profile.localizedFirstName, profile.localizedLastName]
          .filter(Boolean)
          .join(" ");
        userHandle = profile.id;
        displayName = name || null;
      } else if (row.toolkit === "tiktok") {
        const tiktok = await getTikTokUserBasicInfo(conn);
        userHandle = tiktok.username ?? tiktok.openId;
        displayName = tiktok.displayName ?? null;
      }
    } catch {
      // ignore — we can backfill later
    }

    await db
      .from("connected_accounts")
      .update({
        status: account.status === "ACTIVE" ? "active" : "pending",
        connected_at: new Date().toISOString(),
        user_handle: userHandle,
        display_name: displayName,
        last_error: null,
      })
      .eq("id", row.id);

    revalidatePath(`/settings/integrations`);
    return { success: true, status: account.status };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to confirm connection",
    };
  }
}

export async function disconnectComposioAccount(
  rowId: string
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();

  const { data: row, error: readErr } = await supabase
    .from("connected_accounts")
    .select("id, tenant_slug, composio_connection_id")
    .eq("id", rowId)
    .single();

  if (readErr || !row) {
    return { success: false, error: "Connection not found" };
  }

  try {
    if (row.composio_connection_id) {
      const composio = createComposioClient();
      await composio.connectedAccounts.delete(row.composio_connection_id).catch(() => {
        // Already revoked upstream — proceed with local cleanup.
      });
    }
    await supabase
      .from("connected_accounts")
      .update({ status: "revoked", last_error: null })
      .eq("id", rowId);

    revalidatePath(`/settings/integrations`);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disconnect",
    };
  }
}

export async function listConnectedAccountsForTenant(
  tenantSlug: string
): Promise<
  Array<{
    id: string;
    toolkit: Toolkit;
    alias: string;
    status: string;
    userHandle: string | null;
    displayName: string | null;
    connectedAt: string | null;
    lastSyncedAt: string | null;
  }>
> {
  await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("connected_accounts")
    .select(
      "id, toolkit, alias, status, user_handle, display_name, connected_at, last_synced_at"
    )
    .eq("tenant_slug", tenantSlug)
    .order("toolkit");

  return (data ?? []).map((r) => ({
    id: r.id,
    toolkit: r.toolkit as Toolkit,
    alias: r.alias,
    status: r.status,
    userHandle: r.user_handle,
    displayName: r.display_name,
    connectedAt: r.connected_at,
    lastSyncedAt: r.last_synced_at,
  }));
}
