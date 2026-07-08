# Pulse Outbound — Chrome extension

Tier-2 Outbound. When you open a prospect's profile on Instagram, TikTok,
X/Twitter, or LinkedIn, a floating **Draft with Pulse** button appears.
Click it, a sidebar opens with an AI-drafted DM in your brand voice. Copy,
paste into the platform's message box, send. Human click still ships the
message — no automation, no ban risk.

## Install (unpacked)

1. `chrome://extensions` → toggle **Developer mode** on.
2. **Load unpacked** → pick this `extension/` folder.
3. The options page opens automatically on first install.
4. In Pulse: **Settings → Integrations → API tokens → New token**. Copy
   the token once (it's only shown at create time).
5. In the extension options page, paste the token and your Pulse URL
   (defaults to `https://pulse-ashy-kappa.vercel.app`). Save.

## Use it

- Visit any Instagram / TikTok / X / LinkedIn profile
- Bottom-right floating button: **Draft with Pulse**
- Sidebar opens:
  - If the prospect already has a draft in Pulse, it's shown
  - Otherwise click **Draft new DM** — Pulse upserts the prospect and
    writes a personalized DM in ~10–15s
- Click **Copy DM** → paste into the native DM composer on the page → Send
- Click **Mark sent in Pulse** to advance the prospect's pipeline stage

## Event platform lead capture

A second, separate capture flow (`event-content.js`) for event/ticketing
platforms confirmed (2026-07-08) to have real organizer data behind
client-side rendering that backend scraping can't reach: **Clooza,
Tickethub.ng, Eventpadi (app.eventpadi.com — requires being signed in),
EventPorte, Tixvnt, Selar**.

- Visit an event or organizer page on any of those platforms
- Bottom-right floating button: **Capture event lead**
- It reads whatever the page shows — event title, price, organizer name,
  and any linked social/Instagram profile — and saves it as a prospect in
  Pulse's Outbound pipeline
- If the auto-detected organizer name looks wrong, highlight the correct
  text on the page *before* clicking Capture — your selection always
  wins over the automatic guess
- Eventpadi's discovery feed is behind a login — sign in to your Eventpadi
  account first, same browser tab

This is intentionally separate from the profile-capture flow above — event
pages have a completely different shape (no single "prospect handle" in
the URL), so it gets its own detection module (`lib/detect-events.js`) and
its own backend endpoint (`/api/ext/event-lead`), decoupled from the
IG/TikTok/X/LinkedIn path so neither can break the other.

## Permissions

- `storage` — stores your token + base URL in `chrome.storage.sync`
- `clipboardWrite` — copies the drafted DM
- `activeTab` — reads the URL to detect the prospect
- Host permissions: `*.vercel.app` and `localhost:3000` (for local dev)

Permissions are deliberately narrow. The extension never auto-sends DMs
or scrapes inbox content — human-in-the-loop by design.

## Icons (optional)

The manifest currently has no icon references — Chrome will use the
default puzzle-piece. To add custom icons, drop 16×16, 48×48, and 128×128
PNGs under `icons/` and uncomment the `"icons"` + `"default_icon"` blocks
in `manifest.json`.

## Developing against localhost

In options, set the Pulse URL to `http://localhost:3000`. Run
`pnpm dev` in the main repo. The extension talks to the route handlers
at `/api/ext/*`.

## File map

- `manifest.json` — MV3 config
- `content.js` + `content.css` — floating FAB + sidebar on host sites (IG/TikTok/X/LinkedIn)
- `event-content.js` — floating FAB for event-platform lead capture (separate flow, shares content.css)
- `popup.html` + `popup.js` — toolbar popup (connection status)
- `options.html` + `options.js` — base URL + token settings
- `background.js` — service worker (opens options on first install)
- `lib/api.js` — fetch wrapper against the Pulse API
- `lib/detect.js` — URL → `{platform, handle}` detector + DOM scraper (profiles)
- `lib/detect-events.js` — URL → `{platformId}` detector + DOM scraper (event pages)
