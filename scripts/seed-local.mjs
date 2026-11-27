// Dummy data for the LOCAL test database only (see scripts/local-db.sh).
// Refuses to run against anything but localhost, so it can never write to
// the live database. All names, handles and addresses are made up.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to seed: ${url || "(no URL)"} is not a local database.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function must(label, p) {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const VOICE = {
  tone: "Warm, direct and local. Short sentences.",
  audience: "Business owners in Nigeria",
  do_list: ["Use the person's name", "Be specific"],
  dont_list: ["No hype", "No exclamation marks"],
  example_posts: ["This weekend in Lagos: three shows worth your time."],
};
const POSITIONING = {
  one_liner: "Test positioning for local development.",
  differentiators: ["Fast payouts", "Local support"],
};

const TENANTS = [
  { slug: "gruve", name: "Gruve (test)", kind: "event organisers" },
  { slug: "sippy", name: "Sippy (test)", kind: "bars and lounges" },
];

const PEOPLE = [
  { email: "test@pulse.local", name: "Test Owner", role: "owner" },
  { email: "ada@pulse.local", name: "Ada Test", role: "member" },
  { email: "bola@pulse.local", name: "Bola Test", role: "member" },
];

async function userId(email, name) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  const found = list?.users?.find((u) => u.email === email);
  if (found) return found.id;
  const created = await must(
    `create ${email}`,
    db.auth.admin.createUser({ email, password: "pulse-local-1", email_confirm: true, user_metadata: { display_name: name } })
  );
  return created.user.id;
}

const STATUSES = ["new", "new", "new", "new", "qualified", "sent", "sent", "replied", "closed_won", "closed_lost"];
const QUALITY = ["unscored", "hot", "warm", "cold"];
const CITIES = ["Lagos", "Abuja", "Calabar"];

async function main() {
  const ids = {};
  for (const p of PEOPLE) ids[p.email] = await userId(p.email, p.name);

  for (const t of TENANTS) {
    await must(
      `tenant ${t.slug}`,
      db.from("tenants").upsert(
        {
          slug: t.slug,
          name: t.name,
          settings: { brand_voice: VOICE, brand_positioning: POSITIONING, currency: "NGN" },
        },
        { onConflict: "slug" }
      )
    );
    for (const p of PEOPLE) {
      await must(
        `membership ${p.email}`,
        db.from("memberships").upsert(
          { user_id: ids[p.email], tenant_slug: t.slug, role: p.role },
          { onConflict: "user_id,tenant_slug" }
        )
      );
    }

    const { count } = await db.from("prospects").select("id", { count: "exact", head: true }).eq("tenant_slug", t.slug);
    if ((count ?? 0) > 0) {
      console.log(`${t.slug}: already has dummy leads, skipping`);
      continue;
    }
    const leads = Array.from({ length: 40 }, (_, i) => ({
      tenant_slug: t.slug,
      platform: "instagram",
      handle: `${t.slug}_test_lead_${i + 1}`,
      display_name: `Test ${t.kind} ${i + 1}`,
      company_name: `Test Business ${i + 1}`,
      city: CITIES[i % CITIES.length],
      website: i % 3 === 0 ? `https://example.com/${t.slug}/${i + 1}` : null,
      bio: `Made-up ${t.kind.slice(0, -1)} for local testing.`,
      status: STATUSES[i % STATUSES.length],
      quality: QUALITY[i % QUALITY.length],
    }));
    await must(`leads ${t.slug}`, db.from("prospects").insert(leads));
    console.log(`${t.slug}: 40 dummy leads`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
