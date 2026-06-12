// scripts/migrate-contentful-landing-model.ts
// Idempotently creates (or tops up) the `seoLandingPage` content type used by
// programmatic SEO landing pages — rendered by the tenant frontend at
// /discover/<slug>. Mirrors migrate-contentful-model.ts (the gruveBlog one).
//
// Env: CONTENTFUL_CMA_TOKEN, CONTENTFUL_SPACE_ID, CONTENTFUL_ENVIRONMENT=master
// Run: pnpm tsx scripts/migrate-contentful-landing-model.ts
// Requires: contentful-management, tsx
//
// NOTE: PUBLISHES a content-type change to the target Contentful space.
// Per-tenant: point CONTENTFUL_SPACE_ID at the workspace whose model you're
// provisioning. Confirm with that workspace's lead before running.
import { createClient } from 'contentful-management';

const SPACE = process.env.CONTENTFUL_SPACE_ID!;
const ENV = process.env.CONTENTFUL_ENVIRONMENT ?? 'master';
const CT_ID = 'seoLandingPage';

const FIELDS = [
  { id: 'title',         name: 'Title',           type: 'Symbol',  required: true },
  { id: 'slug',          name: 'Slug',            type: 'Symbol',  required: true, unique: true },
  { id: 'description',   name: 'Description',     type: 'Text' },
  { id: 'content',       name: 'Content',         type: 'RichText' },
  { id: 'category',      name: 'Category',        type: 'Symbol' },
  { id: 'location',      name: 'Location',        type: 'Symbol' },
  { id: 'seoTitle',      name: 'SEO Title',       type: 'Symbol' },
  { id: 'seoDescription',name: 'SEO Description', type: 'Symbol' },
  { id: 'canonicalUrl',  name: 'Canonical URL',   type: 'Symbol' },
  { id: 'faqItems',      name: 'FAQ Items',       type: 'Object' },
  { id: 'jsonLd',        name: 'JSON-LD Overrides', type: 'Object' },
  { id: 'publishedDate', name: 'Published Date',  type: 'Date' },
  { id: 'updatedDate',   name: 'Updated Date',    type: 'Date' },
  { id: 'noindex',       name: 'No Index',        type: 'Boolean' },
  { id: 'bannerImage',   name: 'Banner Image',    type: 'Link', linkType: 'Asset' },
  { id: 'pulseId',       name: 'Pulse ID',        type: 'Symbol', unique: true },
] as const;

function toField(f: (typeof FIELDS)[number]) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    required: 'required' in f ? f.required : false,
    localized: false,
    omitted: false,
    ...('linkType' in f ? { linkType: f.linkType } : {}),
    validations: 'unique' in f && f.unique ? [{ unique: true }] : [],
  } as unknown;
}

async function main() {
  const client = createClient(
    { accessToken: process.env.CONTENTFUL_CMA_TOKEN! },
    { type: 'legacy' }
  );
  const space = await client.getSpace(SPACE);
  const environment = await space.getEnvironment(ENV);

  let ct;
  try {
    ct = await environment.getContentType(CT_ID);
    console.log(`• ${CT_ID} exists — topping up missing fields`);
  } catch {
    ct = null;
  }

  if (!ct) {
    const created = await environment.createContentTypeWithId(CT_ID, {
      name: 'SEO Landing Page',
      displayField: 'title',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields: FIELDS.map(toField) as any,
    });
    await created.publish();
    console.log(`✅ created & published ${CT_ID} with ${FIELDS.length} fields.`);
    return;
  }

  let changed = false;
  for (const f of FIELDS) {
    if (ct.fields.some((x) => x.id === f.id)) {
      console.log(`✓ ${f.id} already present — skipping`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ct.fields.push(toField(f) as any);
    console.log(`+ added ${f.id} (${f.type})`);
    changed = true;
  }
  if (!changed) { console.log('Nothing to do — model already complete.'); return; }
  const updated = await ct.update();
  await updated.publish();
  console.log(`✅ ${CT_ID} updated & published.`);
}

main().catch((e) => { console.error('CMA landing migration failed:', e); process.exit(1); });
