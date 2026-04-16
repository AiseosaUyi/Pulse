// One-time seed: create the founder account + Gruve/Sippy tenants.
// Run: node --env-file=.env.local scripts/seed.mjs
//
// Expects in .env.local:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SEED_EMAIL, SEED_PASSWORD, SEED_USERNAME (SEED_DISPLAY_NAME optional)

import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SEED_EMAIL,
  SEED_PASSWORD,
  SEED_USERNAME,
  SEED_DISPLAY_NAME,
} = process.env;

const missing = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!SEED_EMAIL) missing.push("SEED_EMAIL");
if (!SEED_PASSWORD) missing.push("SEED_PASSWORD");
if (!SEED_USERNAME) missing.push("SEED_USERNAME");
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANTS = [
  { slug: "gruve", name: "Gruve" },
  { slug: "sippy", name: "Sippy" },
];

async function findOrCreateUser() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const existing = data.users.find(
    (u) => u.email?.toLowerCase() === SEED_EMAIL.toLowerCase()
  );
  if (existing) {
    console.log(`user:  ${SEED_EMAIL} (exists)`);
    return existing;
  }
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: {
      username: SEED_USERNAME,
      display_name: SEED_DISPLAY_NAME ?? SEED_USERNAME,
    },
  });
  if (createErr) throw createErr;
  console.log(`user:  ${SEED_EMAIL} (created)`);
  return created.user;
}

async function ensureProfile(user) {
  const { error } = await admin.from("profiles").upsert({
    id: user.id,
    username: SEED_USERNAME,
    display_name: SEED_DISPLAY_NAME ?? SEED_USERNAME,
  });
  if (error) throw error;
  console.log(`prof:  ${SEED_USERNAME}`);
}

async function ensureTenantsAndMemberships(user) {
  for (const t of TENANTS) {
    const { error: tErr } = await admin.from("tenants").upsert({
      slug: t.slug,
      name: t.name,
      created_by: user.id,
    });
    if (tErr) throw tErr;

    const { error: mErr } = await admin.from("memberships").upsert({
      user_id: user.id,
      tenant_slug: t.slug,
      role: "owner",
    });
    if (mErr) throw mErr;

    console.log(`team:  ${t.slug} (owner)`);
  }
}

async function main() {
  const user = await findOrCreateUser();
  await ensureProfile(user);
  await ensureTenantsAndMemberships(user);
  console.log("\ndone. login with SEED_EMAIL + SEED_PASSWORD.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
