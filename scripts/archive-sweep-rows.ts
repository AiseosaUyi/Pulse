#!/usr/bin/env tsx

try {
  process.loadEnvFile?.(".env.local");
} catch {}

import { createAdminClient } from "@/lib/supabase/admin";
import { archiveOldSweepRows } from "@/lib/services/archive-sweep";

async function main() {
  const admin = createAdminClient();
  const { data: tenants, error } = await admin.from("tenants").select("slug");
  if (error || !tenants) {
    console.error("Failed to load tenants:", error);
    process.exit(1);
  }

  console.log(`[Archive Sweep] Checking ${tenants.length} tenants...`);

  for (const t of tenants) {
    const res = await archiveOldSweepRows(admin, t.slug);
    console.log(`\nTenant: ${t.slug}`);
    console.log(`  Archived ${res.archivedCount} old sweep/batch rows.`);
    console.log(`  Protected ${res.skippedMoneyCount} money-related rows.`);
    if (res.archivedTitles.length > 0) {
      console.log(`  Sample archived titles:`);
      for (const title of res.archivedTitles.slice(0, 5)) {
        console.log(`    - ${title}`);
      }
    }
  }

  console.log("\n[Archive Sweep] Done.");
}

main().catch((err) => {
  console.error("Error running sweep archive script:", err);
  process.exit(1);
});
