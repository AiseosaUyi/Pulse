// scripts/migrate-contentful-model.ts
// Idempotently adds Pulse SEO fields to the `gruveBlog` content type.
// Env: CONTENTFUL_CMA_TOKEN, CONTENTFUL_SPACE_ID=nc7eiymdfagh, CONTENTFUL_ENVIRONMENT=master
//
// Phase 0 prerequisite. Run: tsx scripts/migrate-contentful-model.ts
// Requires: pnpm add -D contentful-management tsx
//
// NOTE: this PUBLISHES a content-type change to Gruve's shared Contentful
// space (nc7eiymdfagh). Confirm with the Gruve lead before running, and
// verify the 7 fields in the Contentful UI before Phase 2.
import { createClient } from 'contentful-management';

const SPACE = process.env.CONTENTFUL_SPACE_ID!;          // nc7eiymdfagh
const ENV = process.env.CONTENTFUL_ENVIRONMENT ?? 'master';
const CT_ID = 'gruveBlog';

const NEW_FIELDS = [
  { id: 'seoTitle',       name: 'SEO Title',       type: 'Symbol' },
  { id: 'seoDescription', name: 'SEO Description', type: 'Symbol' },
  { id: 'canonicalUrl',   name: 'Canonical URL',   type: 'Symbol' },
  { id: 'faqItems',       name: 'FAQ Items',       type: 'Object' },
  { id: 'jsonLd',         name: 'JSON-LD Overrides', type: 'Object' },
  { id: 'pulseId',        name: 'Pulse ID',        type: 'Symbol' },        // idempotency key
  { id: 'pulseMetadata',  name: 'Pulse Metadata',  type: 'Object', omitted: true }, // hidden
  // ── SEO / E-E-A-T expansion (slice 2) ──
  { id: 'tags',          name: 'Tags',            type: 'Array', items: { type: 'Symbol' } }, // keywords / topical clustering
  { id: 'category',      name: 'Category',        type: 'Symbol' },        // breadcrumbs + category landing links
  { id: 'authorBio',     name: 'Author Bio',      type: 'Text' },          // Person schema description (E-E-A-T)
  { id: 'authorTitle',   name: 'Author Title',    type: 'Symbol' },        // Person.jobTitle
  { id: 'authorUrl',     name: 'Author URL',      type: 'Symbol' },        // Person.url
  { id: 'publishedDate', name: 'Published Date',  type: 'Date' },          // datePublished override
  { id: 'updatedDate',   name: 'Updated Date',    type: 'Date' },          // dateModified override
  { id: 'noindex',       name: 'No Index',        type: 'Boolean' },       // keep thin pages out of the index
] as const;

async function main() {
  // contentful-management v12 defaults createClient() to the plain client
  // (no .getSpace chain). { type: 'legacy' } selects the chainable API this
  // script uses. Legacy is deprecated but fine for a one-off migration.
  const client = createClient(
    { accessToken: process.env.CONTENTFUL_CMA_TOKEN! },
    { type: 'legacy' }
  );
  const space = await client.getSpace(SPACE);
  const environment = await space.getEnvironment(ENV);
  const ct = await environment.getContentType(CT_ID);

  let changed = false;
  for (const f of NEW_FIELDS) {
    if (ct.fields.some((x) => x.id === f.id)) {
      console.log(`✓ ${f.id} already present — skipping`);
      continue;
    }
    ct.fields.push({
      id: f.id, name: f.name, type: f.type,
      required: false, localized: false,
      omitted: 'omitted' in f ? f.omitted : false,
      // Array fields need an `items` spec (e.g. tags = Array<Symbol>).
      ...('items' in f ? { items: f.items } : {}),
      // pulseId should be unique-ish; enforce via app logic + a validation
      validations: f.id === 'pulseId' ? [{ unique: true }] : [],
    } as any);
    console.log(`+ added ${f.id} (${f.type})`);
    changed = true;
  }

  if (!changed) { console.log('Nothing to do — model already migrated.'); return; }
  const updated = await ct.update();
  await updated.publish();
  console.log('✅ gruveBlog content type updated & published.');
}

main().catch((e) => { console.error('CMA migration failed:', e); process.exit(1); });
