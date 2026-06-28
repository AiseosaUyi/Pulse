// scripts/migrate-sippy-contentful-model.ts
// Idempotently adds Pulse SEO fields to the `sippyBlog` content type in Sippy's Contentful space.
// Env: CONTENTFUL_SIPPY_CMA_TOKEN, CONTENTFUL_SIPPY_SPACE_ID, CONTENTFUL_SIPPY_ENVIRONMENT=master
//
// Run: tsx scripts/migrate-sippy-contentful-model.ts
// Requires: pnpm add -D contentful-management tsx
//
// NOTE: this PUBLISHES a content-type change to Sippy's Contentful space.
// Confirm with the Sippy lead before running, and verify the added fields
// in the Contentful UI before wiring the Pulse publish pipeline.
//
// Existing fields preserved (not touched): blogTitle, blogContent, bannerImage, thumbnail, readTime
import { createClient } from 'contentful-management';

const SPACE = process.env.CONTENTFUL_SIPPY_SPACE_ID!;
const ENV   = process.env.CONTENTFUL_SIPPY_ENVIRONMENT ?? 'master';
const CT_ID = 'sippyBlog';

const NEW_FIELDS = [
  // ── Routing & idempotency ──
  { id: 'slug',          name: 'Slug',            type: 'Symbol', unique: true },  // URL key; Pulse idempotency
  { id: 'pulseId',       name: 'Pulse ID',        type: 'Symbol', unique: true },  // blog_posts.id from Pulse DB
  { id: 'pulseMetadata', name: 'Pulse Metadata',  type: 'Object', omitted: true }, // hidden; written by Pulse only

  // ── SEO meta ──
  { id: 'description',    name: 'Description',    type: 'Text' },    // excerpt / meta fallback
  { id: 'seoTitle',       name: 'SEO Title',      type: 'Symbol' },  // overrides blogTitle in <title>
  { id: 'seoDescription', name: 'SEO Description',type: 'Symbol' },  // overrides description in meta
  { id: 'canonicalUrl',   name: 'Canonical URL',  type: 'Symbol' },

  // ── Structured data ──
  { id: 'faqItems',  name: 'FAQ Items',       type: 'Object' }, // Array<{question,answer}>
  { id: 'jsonLd',    name: 'JSON-LD Overrides', type: 'Object' },

  // ── Taxonomy ──
  { id: 'tags',     name: 'Tags',     type: 'Array', items: { type: 'Symbol' } },
  { id: 'category', name: 'Category', type: 'Symbol' },

  // ── E-E-A-T ──
  { id: 'authorBio', name: 'Author Bio', type: 'Text' },

  // ── Crawl control ──
  { id: 'noindex', name: 'No Index', type: 'Boolean' },
] as const;

async function main() {
  const token = process.env.CONTENTFUL_SIPPY_CMA_TOKEN;
  if (!token) throw new Error('CONTENTFUL_SIPPY_CMA_TOKEN is not set');
  if (!SPACE)  throw new Error('CONTENTFUL_SIPPY_SPACE_ID is not set');

  const client = createClient(
    { accessToken: token },
    { type: 'legacy' }
  );

  const space       = await client.getSpace(SPACE);
  const environment = await space.getEnvironment(ENV);
  const ct          = await environment.getContentType(CT_ID);

  console.log(`\nMigrating content type "${CT_ID}" in space ${SPACE} (env: ${ENV})\n`);

  let changed = false;
  for (const f of NEW_FIELDS) {
    if (ct.fields.some((x) => x.id === f.id)) {
      console.log(`  ✓ ${f.id} already present — skipping`);
      continue;
    }

    const validations: object[] = [];
    if ('unique' in f && f.unique) validations.push({ unique: true });

    ct.fields.push({
      id:         f.id,
      name:       f.name,
      type:       f.type,
      required:   false,
      localized:  false,
      omitted:    'omitted' in f ? f.omitted : false,
      validations,
      ...('items' in f ? { items: f.items } : {}),
    } as any);

    console.log(`  + added ${f.id} (${f.type})`);
    changed = true;
  }

  if (!changed) {
    console.log('\nNothing to do — sippyBlog model already fully migrated.');
    return;
  }

  const updated = await ct.update();
  await updated.publish();
  console.log(`\n✅ sippyBlog content type updated & published (${NEW_FIELDS.length} fields checked).`);
}

main().catch((e) => { console.error('CMA migration failed:', e); process.exit(1); });
