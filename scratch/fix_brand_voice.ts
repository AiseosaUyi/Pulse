import fs from "fs";
const envFile = fs.readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
import { createAdminClient } from "../src/lib/supabase/admin";

async function fix() {
  const admin = createAdminClient();
  const slugs = ["sippy", "gruve"];

  for (const slug of slugs) {
    const { data: tenant } = await admin.from("tenants").select("name, settings").eq("slug", slug).single();
    if (!tenant) continue;
    const name = tenant.name || slug;

    const existing = (tenant.settings as Record<string, unknown>) ?? {};
    if (!existing.brand_voice) {
      console.log(`Setting brand_voice for ${slug}...`);
      const voice = {
        tone: `Clear, professional, and engaging voice for ${name}.`,
        audience: `Customers and audience interested in ${name}.`,
        do_list: ["Be clear, direct, and valuable", "Maintain an authentic brand tone"],
        dont_list: ["Avoid overly dense jargon", "Don't post without clear value"],
        example_posts: [`Welcome to ${name}! We are excited to share our latest updates with you.`],
      };
      const positioning = {
        mission: `Building value and audience engagement for ${name}.`,
        value_proposition: `Delivering consistent, valuable insights for ${name}'s audience.`,
        target_demographics: [{ segment: "Target Audience", pain_points: ["Finding reliable information"] }],
        topics_to_cover: ["Product updates", "Industry insights"],
        topics_to_avoid: [],
        competitors: [],
        differentiators: ["Clear value proposition"],
      };

      const merged = { ...existing, brand_voice: voice, brand_positioning: positioning };
      const { error } = await admin.from("tenants").update({ settings: merged }).eq("slug", slug);
      console.log(`Update ${slug} result error:`, error);
    }
  }
}

fix();
