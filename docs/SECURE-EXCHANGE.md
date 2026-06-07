# Secure secret exchange & Contentful model migration

How Pulse ↔ Gruve move secrets and run the one-time content-model
migration. Channel is **Discord** (was Slack — irrelevant to the
mechanism; age is end-to-end, the channel only carries ciphertext).

## Keys & who holds what

| Item | Holder | Lives where | In an env var? |
|---|---|---|---|
| Pulse age **public** key (`age1…`) | Pulse generates; sent to Gruve | Discord message | ❌ no — used once by `age -r` |
| Pulse age **private** key (`AGE-SECRET-KEY-1…`) | Pulse only | file **outside the repo**, trusted machine | ❌ no |
| Gruve age public key (`age10fhgd8ww…m5gg`) | Gruve gave it; Pulse uses it | Discord / this doc | ❌ no |
| `CONTENTFUL_CMA_TOKEN` | Gruve mints → Pulse decrypts | **Pulse Vercel env** (decrypted) | ✅ yes |
| `PREVIEW_SHARED_SECRET` | Pulse generates | Pulse Vercel env **and** Gruve env | ✅ both sides |
| `PULSE_BEACON_SECRET` | Pulse generates | Pulse Vercel env **and** Gruve env | ✅ both sides |

age keys are **transport only** — nothing reads them at runtime.

## Generate Pulse keys/secrets (Pulse, trusted machine, NOT in chat/CI)

```
age-keygen -o ~/pulse-age-key.txt   # store OUTSIDE the repo; share only the age1… public line
openssl rand -hex 32                # → PREVIEW_SHARED_SECRET
openssl rand -hex 32                # → PULSE_BEACON_SECRET
```

Verify the public-key fingerprint out of band (call / compare last 8
chars) before either side encrypts anything real — the ciphertext over
Discord is safe; the key handshake is the MITM-sensitive part.

## Exchange

**Pulse → Gruve** (the two shared secrets):
```
printf 'PREVIEW_SHARED_SECRET=%s\nPULSE_BEACON_SECRET=%s\n' "$P" "$B" \
  | age -r age10fhgd8ww67mhfhxfxsxrlpcv53lcqjylqkcnqd708j77qgd9cvjss0m5gg -a
```
Paste the ASCII blob in the private Discord channel. Gruve decrypts and
sets both in their env. Timing: at cutover.

**Gruve → Pulse** (the CMA token): Gruve encrypts to Pulse's public key
and posts the blob. Pulse decrypts:
```
age -d -i ~/pulse-age-key.txt <<< '<blob>'
```

## Content-model migration — Pulse runs it (not Gruve, not "on Contentful")

The script is a **client** of Contentful's Management API. It runs
wherever Pulse runs `pnpm tsx`; Contentful has no script runner. Gruve's
only job is mint + send the token.

```
CONTENTFUL_CMA_TOKEN='<decrypted>' \
CONTENTFUL_SPACE_ID=nc7eiymdfagh \
CONTENTFUL_ENVIRONMENT=master \
pnpm tsx scripts/migrate-contentful-model.ts
```

Idempotent (skips existing fields). Adds to `gruveBlog`: `seoTitle`,
`seoDescription`, `canonicalUrl`, `faqItems`, `jsonLd`, `pulseId`,
`pulseMetadata`. Then verify in the Contentful UI before the first
publish. ⚠️ Mutates Gruve **production** content model — run inside the
agreed cutover window even though Pulse executes it.
