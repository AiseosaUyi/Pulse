import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_MAILBOX_REGEX } from "@/lib/outbound/email-evidence";
import type {
  LedgerKeyType,
  LedgerKind,
  OutreachLedgerEntry,
  LedgerAddInput,
  LedgerListFilter,
} from "@/lib/types/ledger";

// ── Key Normalisation ────────────────────────────────────────────────────────

/**
 * Normalise domain:
 * - lowercase
 * - strip scheme (http://, https://)
 * - strip leading www.
 * - strip path, query, port, and trailing slashes
 */
export function normalizeDomain(input?: string | null): string {
  if (!input) return "";
  let clean = input.trim().toLowerCase();
  clean = clean.replace(/^[a-z]+:\/\//i, "");
  clean = clean.replace(/^www\./i, "");
  clean = clean.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  return clean.trim();
}

/**
 * Normalise email:
 * - lowercase
 * - trim whitespace
 */
export function normalizeEmail(input?: string | null): string {
  if (!input) return "";
  return input.trim().toLowerCase();
}

/**
 * Normalise social handle:
 * - lowercase
 * - strip leading @
 * - trim whitespace
 */
export function normalizeHandle(input?: string | null): string {
  if (!input) return "";
  return input.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Normalise phone number to E.164:
 * - strip non-digits except leading +
 * - convert Nigerian domestic 0... to +234...
 * - prepend + if missing
 */
export function normalizePhone(input?: string | null): string {
  if (!input) return "";
  let clean = input.trim().replace(/[^\d+]/g, "");
  if (!clean) return "";

  // Convert Nigerian domestic (e.g. 080..., 070..., 090..., 081...) to E.164
  if (clean.startsWith("0") && clean.length >= 10 && clean.length <= 11) {
    clean = "+234" + clean.slice(1);
  } else if (!clean.startsWith("+")) {
    clean = "+" + clean;
  }
  return clean;
}

/**
 * Company domain implied by an email address, or "" when the address is on a
 * free mailbox provider. A gmail.com address says nothing about the company,
 * so it must never become a DOMAIN ledger key (that would block every gmail
 * prospect without a website).
 */
export function companyDomainFromEmail(email?: string | null): string {
  if (!email || !email.includes("@")) return "";
  const d = normalizeDomain(email.split("@").pop());
  if (!d || FREE_MAILBOX_REGEX.test(d)) return "";
  return d;
}

export function normalizeLedgerKey(keyType: LedgerKeyType, key: string): string {
  switch (keyType) {
    case "DOMAIN":
      return normalizeDomain(key);
    case "EMAIL":
      return normalizeEmail(key);
    case "HANDLE":
      return normalizeHandle(key);
    case "PHONE":
      return normalizePhone(key);
  }
}

// ── Ledger Operations ────────────────────────────────────────────────────────

export async function ledgerAdd(
  client: SupabaseClient,
  workspace: string,
  input: LedgerAddInput
): Promise<{ success: boolean; added: OutreachLedgerEntry[]; sent: false }> {
  const itemsToAdd: Array<{ keyType: LedgerKeyType; key: string }> = [];

  if (input.domain) {
    const k = normalizeDomain(input.domain);
    if (k) itemsToAdd.push({ keyType: "DOMAIN", key: k });
  }
  if (input.email) {
    const k = normalizeEmail(input.email);
    if (k) itemsToAdd.push({ keyType: "EMAIL", key: k });
  }
  if (input.handle) {
    const k = normalizeHandle(input.handle);
    if (k) itemsToAdd.push({ keyType: "HANDLE", key: k });
  }
  if (input.phone) {
    const k = normalizePhone(input.phone);
    if (k) itemsToAdd.push({ keyType: "PHONE", key: k });
  }
  if (input.keyType && input.key) {
    const k = normalizeLedgerKey(input.keyType, input.key);
    if (k && !itemsToAdd.some((item) => item.keyType === input.keyType && item.key === k)) {
      itemsToAdd.push({ keyType: input.keyType, key: k });
    }
  }

  const added: OutreachLedgerEntry[] = [];
  const failures: string[] = [];

  for (const item of itemsToAdd) {
    // Check existing row for no-downgrade rule
    const { data: existing } = await client
      .from("outreach_ledger")
      .select("*")
      .eq("workspace", workspace)
      .eq("key_type", item.keyType)
      .eq("key", item.key)
      .maybeSingle();

    if (existing) {
      if (existing.kind === "CONTACTED" && input.kind === "DROPPED") {
        // Rule: A CONTACTED row is NEVER downgraded to DROPPED
        added.push(ledgerRowToEntry(existing));
        continue;
      }

      // Update row
      const { data: updated, error: updateErr } = await client
        .from("outreach_ledger")
        .update({
          kind: input.kind,
          reason: input.reason ?? existing.reason,
          run_id: input.runId ?? existing.run_id,
          company_name: input.companyName ?? existing.company_name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (updateErr || !updated) {
        failures.push(`${item.keyType}:${item.key}: ${updateErr?.message ?? "no row"}`);
      } else {
        added.push(ledgerRowToEntry(updated));
      }
    } else {
      // Insert new row
      const { data: inserted, error: insertErr } = await client
        .from("outreach_ledger")
        .insert({
          workspace,
          key_type: item.keyType,
          key: item.key,
          kind: input.kind,
          reason: input.reason ?? null,
          run_id: input.runId ?? null,
          company_name: input.companyName ?? null,
        })
        .select("*")
        .single();

      if (insertErr || !inserted) {
        failures.push(`${item.keyType}:${item.key}: ${insertErr?.message ?? "no row"}`);
      } else {
        added.push(ledgerRowToEntry(inserted));
      }
    }
  }

  if (failures.length) {
    console.warn("[ledgerAdd] Some ledger writes failed", failures);
  }
  return { success: failures.length === 0, added, sent: false };
}

/** Quote a value for a PostgREST `in.(...)` list, escaping `\` and `"` so a
 * value can't break out of the filter. */
function quoteOrValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function ledgerList(
  client: SupabaseClient,
  workspace: string,
  filter: LedgerListFilter = {}
): Promise<{ entries: OutreachLedgerEntry[]; sent: false }> {
  let query = client
    .from("outreach_ledger")
    .select("*")
    .eq("workspace", workspace)
    .order("created_at", { ascending: false });

  if (filter.kind) {
    query = query.eq("kind", filter.kind);
  }
  if (filter.runId) {
    query = query.eq("run_id", filter.runId);
  }

  const normalizedDomains = (filter.domains || []).map(normalizeDomain).filter(Boolean);
  const normalizedEmails = (filter.emails || []).map(normalizeEmail).filter(Boolean);
  const normalizedHandles = (filter.handles || []).map(normalizeHandle).filter(Boolean);
  const normalizedPhones = (filter.phones || []).map(normalizePhone).filter(Boolean);

  const orConditions: string[] = [];
  if (normalizedDomains.length) {
    orConditions.push(`and(key_type.eq.DOMAIN,key.in.(${normalizedDomains.map(quoteOrValue).join(",")}))`);
  }
  if (normalizedEmails.length) {
    orConditions.push(`and(key_type.eq.EMAIL,key.in.(${normalizedEmails.map(quoteOrValue).join(",")}))`);
  }
  if (normalizedHandles.length) {
    orConditions.push(`and(key_type.eq.HANDLE,key.in.(${normalizedHandles.map(quoteOrValue).join(",")}))`);
  }
  if (normalizedPhones.length) {
    orConditions.push(`and(key_type.eq.PHONE,key.in.(${normalizedPhones.map(quoteOrValue).join(",")}))`);
  }

  if (orConditions.length) {
    query = query.or(orConditions.join(","));
  }

  if (filter.limit && filter.limit > 0) {
    query = query.limit(filter.limit);
  } else {
    query = query.limit(100);
  }

  const { data, error } = await query;
  if (error || !data) return { entries: [], sent: false };

  return {
    entries: data.map(ledgerRowToEntry),
    sent: false,
  };
}

/**
 * Checks if a prospect's domain, handle, email, or phone is already in the ledger.
 * Fails open: on error, logs a warning and returns { inLedger: false }.
 */
export async function ledgerCheck(
  client: SupabaseClient,
  workspace: string,
  candidate: { domain?: string | null; handle?: string | null; email?: string | null; phone?: string | null }
): Promise<{ inLedger: boolean; entry?: OutreachLedgerEntry }> {
  try {
    const checks: Array<{ keyType: LedgerKeyType; key: string }> = [];

    const d = normalizeDomain(candidate.domain);
    if (d) checks.push({ keyType: "DOMAIN", key: d });

    const h = normalizeHandle(candidate.handle);
    if (h) checks.push({ keyType: "HANDLE", key: h });

    const e = normalizeEmail(candidate.email);
    if (e) checks.push({ keyType: "EMAIL", key: e });

    const p = normalizePhone(candidate.phone);
    if (p) checks.push({ keyType: "PHONE", key: p });

    if (!checks.length) return { inLedger: false };

    for (const c of checks) {
      const { data, error } = await client
        .from("outreach_ledger")
        .select("*")
        .eq("workspace", workspace)
        .eq("key_type", c.keyType)
        .eq("key", c.key)
        .maybeSingle();

      if (error) {
        console.warn(`[ledgerCheck] Query error for ${c.keyType}:${c.key}`, error.message);
        continue;
      }
      if (data) {
        // A DROPPED email only means that address failed verification. It must
        // not block the whole prospect (the next upsert may carry a good email).
        if (c.keyType === "EMAIL" && data.kind === "DROPPED") continue;
        return { inLedger: true, entry: ledgerRowToEntry(data) };
      }
    }
    return { inLedger: false };
  } catch (err) {
    console.warn("[ledgerCheck] Failed open on unexpected error", err);
    return { inLedger: false };
  }
}

/**
 * Best-effort helper called whenever a DM, email, or reply is marked sent.
 * Records CONTACTED for domain, email, handle, and phone. Never throws.
 */
export async function recordContactedFromProspect(
  client: SupabaseClient,
  workspace: string,
  prospect: {
    handle?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    profileUrl?: string | null;
    companyName?: string | null;
    displayName?: string | null;
    runId?: string | null;
  },
  reason = "Outreach message marked sent"
): Promise<void> {
  try {
    let domain: string | undefined = undefined;
    if (prospect.website) {
      domain = normalizeDomain(prospect.website);
    } else {
      domain = companyDomainFromEmail(prospect.email) || undefined;
    }

    await ledgerAdd(client, workspace, {
      kind: "CONTACTED",
      domain,
      email: prospect.email ?? undefined,
      handle: prospect.handle ?? undefined,
      phone: prospect.phone ?? undefined,
      companyName: prospect.companyName ?? prospect.displayName ?? undefined,
      reason,
      runId: prospect.runId ?? undefined,
    });
  } catch (err) {
    console.warn("[recordContactedFromProspect] Best-effort ledger record failed", err);
  }
}

function ledgerRowToEntry(row: Record<string, unknown>): OutreachLedgerEntry {
  return {
    id: row.id as string,
    workspace: (row.workspace as string) ?? (row.tenant_slug as string),
    tenantSlug: (row.tenant_slug as string) ?? (row.workspace as string),
    keyType: row.key_type as LedgerKeyType,
    key: row.key as string,
    kind: row.kind as LedgerKind,
    reason: (row.reason as string) || null,
    runId: (row.run_id as string) || null,
    companyName: (row.company_name as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
