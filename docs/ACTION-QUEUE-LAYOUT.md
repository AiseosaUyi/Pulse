# Action Queue — layout revision

Follow-up to `docs/ACTION-QUEUE-BRIEF.md`. The queue works. The layout does not.

## The problem

`QueueGroup.tsx` renders every group the same way: a full-width `QueueRowCard`, stacked
vertically, `space-y-2`, forever. With 46 open rows that is a 46-row scroll where a 5-day-old
question from a hot lead sits below thirteen duplicate SEO chores. Everything is the same size, so
nothing has weight, and the things that need you are genuinely hard to find.

## The principle

**Density is inverse to the work the row demands.**

A reply you have to compose needs width, a textarea and five controls. A prospect name you only
have to recognise needs a chip. Right now both get the same 100%-width card, which wastes the
screen on the cheap rows and buries the expensive ones.

Four render variants, chosen by `kind`, not one card for everything:

| Variant | Used by | Shape | Columns |
|---|---|---|---|
| `compose` | `reply` | Full card: message, editable textarea, Open / Copy / Resolve / Snooze / Assign | 1 |
| `card` | `decision`, `escalation`, `opportunity` | Title, `why`, one primary action, priority chip | 2 |
| `line` | `chore`, `follow_up` | One line: title, action link, overflow menu | 2 on desktop, 3 for chores |
| `chip` | going-cold prospects | Avatar, handle, days-since, select checkbox | 4 |

Add `variant` to `QueueRowCard`, defaulting to `compose` so nothing breaks, and let `QueueGroup`
pass it plus a column count.

## The layout

Page is `max-w-[1200px]`, existing gutters, scrolling in the dashboard container
(`h-[calc(100vh-6rem)] overflow-y-auto` — the window itself does not scroll, per GRUVE-DESIGN §13).
Use `SimpleGrid` for every multi-column region rather than bespoke `grid-cols-*`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dashboard                                    [bell]  [Weekly report] │
│  8 need a reply · 3 decisions · oldest waiting 5 days                 │
├──────────────────────────────────────────────────────────────────────┤
│  Needs you — 5 open (3 blocking)                            [collapse]│
├──────────────────────────────────────────────────────────────────────┤
│  [All platforms ▾] [All kinds ▾] [Everyone|Me|Unassigned]  Resolved ↗ │  ← sticky
├─────────────────────────────────────┬────────────────────────────────┤
│  NEEDS A REPLY               8      │  NEEDS A DECISION         3    │
│  ── the work ──                     │  ── answer these ──            │
│  ┌───────────────────────────────┐  │  ┌──────────────────────────┐  │
│  │ im_flyboi · Comment · 1d  URG │  │  │ Collab invites ×3   HIGH │  │
│  │ "How does it work"            │  │  │ why: warm partner, 3×    │  │
│  │ ┌───────────────────────────┐ │  │  │ [Open the invite]        │  │
│  │ │ editable draft…           │ │  │  └──────────────────────────┘  │
│  │ └───────────────────────────┘ │  │  ┌──────────────────────────┐  │
│  │ Open · Copy · Resolve · …     │  │  │ Unread thread       HIGH │  │
│  └───────────────────────────────┘  │  └──────────────────────────┘  │
│  ┌───────────────────────────────┐  ├────────────────────────────────┤
│  │ MIDNIGHT RITUAL · DM · 4h URG │  │  FOLLOW-UPS DUE           1    │
│  └───────────────────────────────┘  │  · sip and paint  [Open]       │
│  … 6 more                           ├────────────────────────────────┤
│                                     │  OPPORTUNITIES            1    │
│                                     │  Pageants · voting gap         │
│                                     │  [Review segment]              │
├─────────────────────────────────────┴────────────────────────────────┤
│  GOING COLD                                    20   [collapsed ▾]    │
│  ⬚ mowaaofficial 34d   ⬚ readmanna 34d   ⬚ thear.tbar 34d   ⬚ …      │
│  ⬚ frnthaus 136d       ⬚ purplexplace 34d …                          │
│                          [Draft final attempt for 3 selected]         │
├──────────────────────────────────────────────────────────────────────┤
│  CHORES                                        13   [collapsed ▾]    │
│  · Rewrite title        · Trim word count      · Add FAQ schema      │
├──────────────────────────────────────────────────────────────────────┤
│  Social reach 0 │ Platforms 0/100 │ Posts 0 │ Engagement —           │
├──────────────────────────────────────────────────────────────────────┤
│  This week — platform breakdown, suggestions, business review   [▾]  │
└──────────────────────────────────────────────────────────────────────┘
```

### Why this shape

- **The split at the top is two different jobs, side by side.** Left is "compose something",
  right is "answer a question". They use different parts of your attention, and stacking them
  means whichever is longer hides the other. Left column `lg:col-span-7`, right `lg:col-span-5`.
- **Only actionable things sit above the fold.** Metrics move below the queue. They are context,
  not work.
- **Going cold is 20 names, not 20 essays.** As chips in a 4-up grid it is one glance instead of a
  minute of scrolling, and it collapses by default. Add multi-select with one bulk action, since
  the realistic move is "draft a final attempt for these five", not one at a time.
- **Chores collapse and go last.** Thirteen near-duplicate SEO tasks about one blog post should
  never outrank a 5-day-old question from a hot lead.
- **The filter bar sticks** (`sticky top-0 z-10` inside the scroll container, with the card
  background so rows do not bleed through). Filtering a 46-row board is useless if you have to
  scroll back up to do it.

### Finding things

- **Colour carries urgency only.** `urgent` gets `border-status-red/30 bg-status-red/5`, `high`
  gets the yellow equivalent, everything else stays `border-border bg-card`. The pattern already
  exists in `needs-you/page.tsx` — reuse `PRIORITY_TONE` rather than inventing a second scale. No
  decorative colour anywhere on the board, so a red edge always means the same thing.
- **Every group header carries its count**, including collapsed ones, so nothing hides silently.
- **Age is always visible and always relative** (`1d`, `5d`, `34d`), and turns red past the reply
  SLA. Age is the single best signal of what is rotting and it should never require a hover.
- **Empty groups render nothing**, they do not render an empty state. Five "nothing here" panels
  is the same clutter problem in a different costume.
- **A row assigned to someone else is dimmed to 60%** with their avatar, so the unclaimed work is
  what visually pops.

### Responsive

- `< 768px`: everything collapses to one column in the order Needs a reply → Decisions →
  Follow-ups → Opportunities → Going cold → Chores → metrics. Chips go 2-up, chores 1-up. The
  textarea stays full width; it is the point of the page.
- `768–1023px`: the top region stays single-column, but `card` variants go 2-up and chips 3-up.
- `≥ 1024px`: the 7/5 split above.

### Do not

- Do not put the queue in tabs. A tab you have to click is a tab that hides an unanswered DM.
- Do not paginate. Collapse instead, so the count is always visible.
- Do not add a second accent colour to distinguish groups. Group headers do that job with type.
