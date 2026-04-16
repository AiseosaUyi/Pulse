# Gruve Design System

This is the canonical design spec for **Gruve** (a Web3 event ticketing platform). Any sibling product built as a "tool of Gruve" should match this spec 1:1 so the surfaces feel like one brand.

Copy this file into the new project's root as `DESIGN.md` and reference it from `CLAUDE.md`.

---

## 1. Brand Feel

Gruve's UI is:

- **Warm, confident, editorial** — maroon primary (not red, not pink), white canvases, lots of breathing room.
- **Rounded and friendly** — buttons are `rounded-full`, inputs `rounded-lg`, cards `rounded-2xl`.
- **Typography-led** — Satoshi variable font at three weights (Regular / Bold / Black) carries most of the visual hierarchy. No serif, no display faces.
- **Flat, no gradients** — one brand gradient exists in marketing surfaces (maroon → deep red); everywhere else is flat fills.
- **Subtle elevation** — almost no shadows in-app; overlays get a `#000000B3` black-wash + `backdrop-blur-sm` for modals.
- **Never playful/quirky** — no emoji in UI copy, no bouncy springs, no cartoon illustrations. Tight motion (200–300ms) only.

If it looks like Linear or Stripe it's wrong. If it looks like a modern lifestyle/ticketing app (Resident Advisor, Partiful, Luma) with a maroon accent, it's right.

---

## 2. Tech Stack (to match)

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"` with `@theme` block) |
| Components | shadcn/ui (New York style) at `components/ui/` |
| Variants | `class-variance-authority` (CVA) |
| Icons | Inline SVGs via a central `Svgs.tsx` map, Lucide for generic glyphs |
| Forms | Formik |
| State | easy-peasy (persisted slices) + SWR for data |
| Package manager | Bun (`bun run dev`, `bun run build`, `bun run lint`, `bun test`) |
| Path alias | `@/*` → project root |

Mirror these choices in the sibling product unless there's a strong reason not to — matching the stack keeps components copy-pasteable.

---

## 3. Color Palette

All colors are declared in `app/globals.css` inside a `@theme { }` block. Paste the block below verbatim; Tailwind v4 will auto-generate `bg-*`, `text-*`, `border-*` utilities.

```css
@theme {
  /* ——— Primary (Maroon — the brand color) ——— */
  --color-primary-50:  #fee4e4;
  --color-primary-100: #fbc2c2;
  --color-primary-200: #f39b9b;
  --color-primary-300: #e07474;
  --color-primary-400: #c7434e;
  --color-primary-500: #ad112c; /* ← default brand */
  --color-primary-600: #960f26; /* hover */
  --color-primary-700: #7f0d20; /* active */
  --color-primary-800: #5e0716;
  --color-primary-900: #3f040e;
  --color-primary-1000: #ea445a; /* accent red (NProgress bar, notifications) */
  --color-primary-1100: #f690a2;
  --color-primary-1200: #e5b1bb;

  /* ——— Gray (text + borders) ——— */
  --color-gray-50:   #f6f7f7;
  --color-gray-100:  #e3e3e4;
  --color-gray-200:  #c6c7c9;
  --color-gray-300:  #aaacad;
  --color-gray-400:  #8d9092;
  --color-gray-500:  #717477;
  --color-gray-600:  #4f5153;
  --color-gray-700:  #393a3c;
  --color-gray-800:  #222324;
  --color-gray-900:  #0b0c0c;
  --color-gray-1000: #666481; /* tertiary button text, muted body */
  --color-gray-1100: #111021; /* headings */
  --color-gray-1200: #2d2b4a; /* primary body */
  --color-gray-1300: #c2c1cf;
  --color-gray-1400: #848d97;
  --color-gray-1500: #22213c;
  --color-gray-1700: #717171;

  /* ——— White (backgrounds + input borders) ——— */
  --color-white-50:  #fbfbfd;
  --color-white-100: #f2f2f6;
  --color-white-200: #e1e1e8; /* default input/card border */
  --color-white-300: #e3e3e4;
  --color-white-400: #fff6f8;
  --color-white-500: #fff3f5;
  --color-white-600: #f9f9fb;
  --color-white-700: #fafafc;

  /* ——— Blue (focus rings, links) ——— */
  --color-blue-50:  #e6edff;
  --color-blue-100: #ccdaff;
  --color-blue-200: #99b5ff;
  --color-blue-300: #6691ff;
  --color-blue-400: #336cff;
  --color-blue-500: #0047ff; /* focus ring */
  --color-blue-600: #0039cc;
  --color-blue-700: #002b99;
  --color-blue-800: #001c66;
  --color-blue-900: #000e33;
  --color-blue-1000: #2684ff;

  /* ——— Semantic ——— */
  --color-success-500: #27ae60;
  --color-success-1000: #edf9f0;
  --color-warning-500: #ff8001; /* also the loader color */
  --color-warning-50:  #fff2e6;
  --color-error-500:   #ff2e00;

  /* ——— Secondary (cool blue-violet, rare) ——— */
  --color-secondary-100: #f0f4ff;
  --color-secondary-500: #7494f3;
  --color-secondary-700: #2053ec;

  /* ——— Shadows ——— */
  --shadow-custom-100: 0px 2px 2px 0px #0000001a;
  --shadow-custom-200: 0px 1px 2px 0px #375dfb14;
}
```

### Color usage rules

| Purpose | Token |
|---|---|
| Brand / primary CTA fill | `primary-500` |
| Primary CTA hover | `primary-600` (darker) |
| Primary CTA active | `primary-700` (darker still) |
| Secondary/outline hover tint | `primary-50` |
| Page background | `white` |
| Card / input border | `white-200` (#e1e1e8) |
| Body text | `gray-1200` (#2d2b4a) |
| Muted / secondary text | `gray-1000` (#666481) or `gray-500` |
| Heading text | `gray-1100` (#111021) |
| Focus ring | `blue-500` at 30% opacity |
| Error state | `destructive` (shadcn default) |
| Success toast/pill | `success-500` on `success-1000` bg |
| Warning loader / pulse | `warning-500` (#ff8001) |

> ⚠️ **Gotcha:** `primary-1000`, `primary-1100`, `primary-1200` are *lighter* than `primary-500`, not darker. Never use them for hover/active — they break the scale's monotonicity. For hover/active go to `primary-600`/`700`.

---

## 4. Typography

**Satoshi** — variable font loaded as four named families, one per weight. Download from fontshare.com and drop into `public/fonts/`.

```css
@font-face { font-family: 'Satoshi';     src: url('/fonts/Satoshi-Regular.woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Satoshi-500'; src: url('/fonts/Satoshi-Medium.woff2');  font-weight: 500; font-display: swap; }
@font-face { font-family: 'Satoshi-700'; src: url('/fonts/Satoshi-Bold.woff2');    font-weight: 700; font-display: swap; }
@font-face { font-family: 'Satoshi-900'; src: url('/fonts/Satoshi-Black.woff2');   font-weight: 900; font-display: swap; }

body            { font-family: 'Satoshi', sans-serif; }
h1              { font-family: 'Satoshi-900', sans-serif; }
h2              { font-family: 'Satoshi-700', sans-serif; }
h3, h4          { font-family: 'Satoshi-500', sans-serif; }
h5, h6, p       { font-family: 'Satoshi', sans-serif; }
span            { font-family: inherit !important; font-weight: inherit !important; }
```

### Font size scale (Tailwind v4 `@theme`)

```css
--text-xxs:   0.625rem;  /* 10px */
--text-xs:    0.75rem;   /* 12px */
--text-sm:    0.875rem;  /* 14px */
--text-base:  1rem;      /* 16px */
--text-md:    1.125rem;  /* 18px */
--text-lg:    1.25rem;   /* 20px */
--text-xl:    1.5rem;    /* 24px */
--text-2xl:   2rem;      /* 32px */
--text-2_5xl: 2.5rem;    /* 40px */
--text-3xl:   3rem;      /* 48px */
--text-3_5xl: 3.5rem;    /* 56px */
--text-4xl:   4rem;      /* 64px */
--text-4_5xl: 4.5rem;    /* 72px */
--text-5xl:   5rem;      /* 80px */
--text-5_5xl: 5.5rem;    /* 88px */
--text-6xl:   6rem;      /* 96px */
```

### Gotcha: the `h2` override

Because `globals.css` sets `h2 { font-family: 'Satoshi-700' }`, Tailwind's `font-black` class **cannot override it** (the named-family rule wins). When an `<h2>` needs weight 900 (e.g. modal titles), do:

```tsx
<h2 style={{ fontFamily: "'Satoshi-900', sans-serif" }}>Title</h2>
// or:
<h2 className="[font-family:'Satoshi-900',sans-serif]">Title</h2>
```

---

## 5. Buttons

Three-tier system, all `rounded-full`, all sized from the same CVA.

### Variants

| Variant | Default | Hover | Active | Use for |
|---|---|---|---|---|
| **Primary** (`default`) | `bg-primary-500 text-white` | `bg-primary-600` | `bg-primary-700` | The one main action per screen |
| **Secondary** (`outline`) | `border-primary-500 text-primary-500 bg-transparent` | `border-primary-600 text-primary-600 bg-primary-50` | `border-primary-700 text-primary-700 bg-primary-100` | Alternate brand-colored action |
| **Tertiary** (`tertiary`) | `border-white-200 text-gray-1000 bg-transparent` | `border-gray-400 text-gray-1200 bg-gray-50` | `border-gray-500 bg-gray-100` | Cancel, dismiss, "Edit Profile", "Follow" |
| **Ghost** | — | `bg-accent` | — | Icon toggles |
| **Unstyled** | no chrome | — | — | Date pickers, bare wrappers |

Disabled state for all: `opacity-50 pointer-events-none`.

### Sizes

| Size | Height | Padding | Text |
|---|---|---|---|
| `xl` | `h-14` | `px-8` | `text-lg` |
| `default` | `h-10 md:h-11` | `px-6 md:px-10` | `text-base` |
| `sm` | `h-9` | `px-4` | `text-sm` |
| `xs` | `h-7` | `px-3` | `text-xs` |
| `icon` | `size-9` | — | — |
| `icon-sm` | `size-8` | — | — |
| `icon-lg` | `size-10` | — | — |

### Canonical implementation

```tsx
// components/ui/button.tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  `flex items-center justify-center gap-2 whitespace-nowrap rounded-full
   [font-family:'Satoshi-900',sans-serif] transition duration-300
   disabled:pointer-events-none cursor-pointer disabled:opacity-50
   [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none
   [&_svg:not([class*='size-'])]:size-4 shrink-0 relative
   focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]
   aria-invalid:border-destructive aria-invalid:ring-destructive/20`,
  {
    variants: {
      variant: {
        default: `bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700`,
        outline: `border border-solid border-primary-500 bg-transparent text-primary-500
          hover:border-primary-600 hover:text-primary-600 hover:bg-primary-50
          active:border-primary-700 active:text-primary-700 active:bg-primary-100`,
        tertiary: `border border-solid border-white-200 bg-transparent text-gray-1000
          hover:border-gray-400 hover:text-gray-1200 hover:bg-gray-50
          active:border-gray-500 active:bg-gray-100`,
        ghost: `hover:bg-accent hover:text-accent-foreground`,
        unstyled: `bg-transparent border-none p-0 h-auto [font-family:'Satoshi',sans-serif]`,
      },
      size: {
        xl: `h-14 px-8 text-lg leading-6 has-[>svg]:px-4`,
        default: `h-10 md:h-11 px-6 md:px-10 py-2 md:py-3 text-base leading-6 has-[>svg]:px-3`,
        sm: `h-9 px-4 text-sm leading-5 has-[>svg]:px-2.5`,
        xs: `h-7 px-3 text-xs leading-4 has-[>svg]:px-2`,
        icon: `size-9`,
        "icon-sm": `size-8`,
        "icon-lg": `size-10`,
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export function Button({ className, variant, size, asChild, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
```

---

## 6. Text Fields (Input / Textarea / Select)

Single visual spec across all text-like inputs.

| Property | Value |
|---|---|
| Height | `h-12` (48px) |
| Border | `border border-white-200` |
| Border radius | `rounded-lg` |
| Background | `bg-transparent` (inherits parent — **never** `bg-white`) |
| Padding | `px-4 py-3` |
| Font size | `text-sm` |
| Focus | `focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30` |
| Error | `aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30` |
| Disabled | `disabled:bg-gray-50 disabled:opacity-50` |
| Placeholder color | `text-gray-1000` via `placeholder:text-gray-1000` |

Compound fields (icon + input, prefix + input, location pickers) follow the same outer spec; the inner `<Input>` is transparent/borderless. Apply `focus-within:` variants to the outer container.

Labels sit above the field, `text-sm font-medium text-gray-1200`, `mb-2` gap.

Helper / error text sits below, `text-xs text-gray-500` (helper) or `text-xs text-destructive` (error), `mt-1` gap.

---

## 7. Modals

Two base components cover ~100% of flows.

### `CenteredModal` — confirmation / success / one-question prompts

- Max width: `max-w-[400px]`
- Centered content
- Close button: absolute top-right, custom `Cancel` SVG at `2.25rem`
- Sub-slots: `Icon`, `Title`, `Description`, `Actions`
- Title: `text-xl` + Satoshi-900 (via `style=` — see §4)
- Description: `text-sm text-gray-500 mb-6 max-w-[280px]`

### `FormModal` — forms, detail views, multi-field flows

- Standard width: `max-w-[520px]`. Wide variant (`wide` prop): `max-w-[700px]`.
- `max-h-[90vh]` with scrollable body.
- Slots: `Header`, `Title`, `Description`, `Body`, `Footer`, `FieldGroup`, `FieldRow`, `Group`, `Section`.

**Spacing rules inside `FormModal.Body`:**

| Context | Slot | Gap |
|---|---|---|
| Between form fields | `FieldGroup` | 16px |
| Horizontally-paired fields in one row | `FieldRow` | 16px |
| Between grouped blocks (e.g. cards) | `Group` | 24px |
| Between semantic sections | `Section` | 40px |

### Backdrop (both)

```tsx
<div className="fixed inset-0 z-30 bg-[#000000B3] backdrop-blur-sm" />
```

Click-outside closes; inner content stops propagation. `z-30` for backdrop, `z-40+` for the modal body.

### `MinimizableModal` — long async flows (e.g. "creating event")

Can minimize to bottom-right corner while work completes. Has `processing`, `success`, `error` states. Only needed if the sibling product has async flows > 5s.

---

## 8. Bottom Sheet (mobile < 768px)

Mobile replacement for form modals.

| Property | Value |
|---|---|
| Border-radius | `rounded-t-2xl` |
| Background | `bg-white` |
| Max height | `max-h-[85dvh]` (dynamic vh — handles iOS keyboard) |
| z-index | `z-50` (above backdrop at `z-30`) |
| Animation in | `animate-in slide-in-from-bottom duration-300` |
| Animation out | `animate-out slide-out-to-bottom duration-200` |
| Drag handle | `w-9 h-1 rounded-full bg-gray-400 mx-auto mt-2` |

### Swipe-down dismiss

Threshold: 80px. On `touchmove`, translate the sheet; on `touchend`, if delta > 80px animate out, else snap back (duration-200).

### Required layout

```
BottomSheet
  ├── handle   (always present)
  ├── header   (sticky, title + optional close)
  ├── body     (flex-1 overflow-y-auto)
  └── footer   (sticky bottom — primary CTA lives HERE, never in the body)
```

### Accessibility

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` → sheet title
- On open: focus first focusable inside the sheet
- On close: return focus to the trigger
- Escape closes
- `aria-hidden="true"` on background content while open
- Body scroll lock (`document.body.style.overflow = 'hidden'`) while open

---

## 9. Fixed CTA Bar (mobile, bottom of detail pages)

| Property | Value |
|---|---|
| Position | `fixed bottom-0 left-0 right-0 z-40` |
| Background | `bg-white` |
| Height | `h-20` + `pb-[env(safe-area-inset-bottom)]` |
| Border-top | `shadow-[0_-1px_0_0_#e1e1e8]` (flat hairline, no blur) |
| Padding | `px-4` |
| Min button touch target | `h-11` |

Layout: `[context text]                       [primary CTA]`

---

## 10. Cards

Cards don't have a dedicated component — they're plain `div`s. Spec:

| Property | Value |
|---|---|
| Background | `bg-white` |
| Border | `border border-white-200` |
| Border radius | `rounded-2xl` (16px — more generous than inputs) |
| Padding | `p-4` (compact) / `p-6` (default) |
| Shadow | None by default. Hover: `shadow-custom-100` (very subtle) |
| Hover transition | `transition-shadow duration-200` |

Event cards specifically use `rounded-2xl overflow-hidden` with an image at the top, text body below.

---

## 11. Motion

- Default duration: `duration-300` (buttons, hover states)
- Fast state changes: `duration-200`
- Entrance animations: `duration-300` with `ease-out`
- Exit animations: `duration-200` with `ease-in`
- Never use bouncy easing. Always linear or `ease-*`.
- `tailwindcss-animate` plugin provides `animate-in` / `animate-out` + `slide-in-from-bottom` / `slide-out-to-bottom` utilities used by modals and sheets.

### Branded loader

A warm orange pulse, not a spinner:

```css
.loader {
  position: relative;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  background-color: #ff8001;
  animation: pulseGlow 1.8s ease-in-out infinite;
}
@keyframes pulseGlow {
  0%   { box-shadow: 0 0 0 0    #ffb367; opacity: 1; }
  50%  { box-shadow: 0 0 0 0.75rem #ffb367; opacity: 0.6; }
  100% { box-shadow: 0 0 0 1.25rem #fff2e6; opacity: 0.9; }
}
```

### Top progress bar (page transitions)

`nextjs-toploader` with color `#ea445a` (primary-1000) — a warmer red than `primary-500` because it reads better on glance.

---

## 12. Radii, Shadows, Z-index

| Token | Value | Use |
|---|---|---|
| `rounded-full` | 9999px | Buttons, pills, avatars |
| `rounded-2xl` | 16px | Cards, bottom sheet top, image containers |
| `rounded-lg` | 8px | Inputs, textareas, selects |
| `rounded-md` | 6px | Small chips, badges |

```
--shadow-custom-100: 0px 2px 2px 0px #0000001a;   /* card hover */
--shadow-custom-200: 0px 1px 2px 0px #375dfb14;   /* subtle depth — rare */
```

| Z-index | Use |
|---|---|
| `z-2` | `RequireLogin` intercept overlay |
| `z-30` | Modal + bottom-sheet backdrop |
| `z-40` | Fixed CTA bars, dropdown popovers |
| `z-50` | Modal / bottom-sheet content |
| `z-[9999]` | Top progress bar (NProgress) |

---

## 13. Layout & Spacing Primitives

- Base unit: 4px (Tailwind default).
- Section vertical rhythm: `py-10` (mobile) → `py-16` (desktop) for marketing; `py-6` → `py-10` for app.
- Page gutter: `px-4` (mobile) → `px-6` (tablet) → `px-8`+ (desktop, bounded by container).
- Max content width for editorial pages: `max-w-[1200px] mx-auto`.
- Max form width: `max-w-[520px]`.
- Dashboard scroll container: `h-[calc(100vh-6rem)]` with `overflow-y-auto` (the window itself doesn't scroll — `window.scrollTo` won't work; scroll the container).

### Breakpoints

Tailwind defaults, plus one custom:

| Prefix | Width |
|---|---|
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `xl:` | 1280px |
| `min-[800px]:` | 800px (custom — header/sidebar switch point) |

### Grid

`SimpleGrid` component handles 1/2/3/4/5/6 responsive columns. Reach for it before writing a bespoke `grid-cols-*` — keeps event/content card grids consistent across the suite.

---

## 14. Iconography

- One central `Svgs.tsx` map exporting named components (`<Cancel />`, `<ArrowRight />`, etc.). Inline SVGs, `currentColor` for strokes/fills so color flows from Tailwind `text-*`.
- Lucide (`lucide-react`) for generic glyphs not in the brand set.
- Default icon size: `1.5rem` (24px). Close/cancel buttons: `2.25rem` (36px).
- Never mix stroke widths in one composition. Gruve-native SVGs are stroke-width 1.5.

---

## 15. Imagery

- Event/content hero images: full-bleed, `object-cover`, `rounded-2xl`.
- Mobile hero (detail pages) uses a blurred self-background trick:
  ```tsx
  <div className="w-full h-72 overflow-hidden relative -mx-4">
    <div className="absolute inset-0 bg-cover bg-center scale-110 blur-[24px] brightness-90"
         style={{ backgroundImage: `url(${img})` }} />
    <img src={img} className="absolute inset-0 object-contain w-full h-full" />
    <button className="absolute top-4 left-4 bg-white/80 backdrop-blur-sm rounded-full p-2">{back}</button>
    <button className="absolute top-4 right-4 bg-white/80 backdrop-blur-sm rounded-full p-2">{share}</button>
  </div>
  ```
  The blur layer uses CSS `background-image` (not a second `<Image>`) to avoid an extra network request. `brightness-90` stops the blur from competing with the crisp centered image.
- Avatars: `rounded-full`, always on a tinted fallback bg (`bg-primary-50` with initial in `text-primary-500`).

---

## 16. Writing & Voice

- **Sentence case everywhere.** Buttons, titles, nav — no Title Case, no ALL CAPS (except inline badges).
- **Imperative for CTAs**: "Get Tickets", "Create Event", "Continue", "Save Changes".
- **No exclamation marks in primary UI.** Reserved for success empty-states ("You're in!").
- **Numbers before units**: "3 tickets", "₦ 5,000", "2 min read".
- **No emoji in persistent UI** (buttons, labels, nav). OK in transient success toasts, empty states, and marketing.

---

## 17. Gotchas the sibling product should inherit

1. `primary-1000/1100/1200` are **lighter** than `primary-500`, not darker. Never use for hover/active on buttons.
2. `h2 { font-family: 'Satoshi-700' }` wins over `font-black`. Use `style={{ fontFamily: "'Satoshi-900', sans-serif" }}`.
3. Inputs must be `bg-transparent`, never `bg-white` — otherwise they visually fight tinted page backgrounds.
4. If you use `shared/Box` / `shared/Flex` wrappers, know they inject `flex-1` / `flex-2` by default and can override percentage widths.
5. Bottom sheet footer MUST live outside the scrollable body — never inside.
6. Dashboard uses a fixed-height scroll container. `window.scrollTo(0,0)` won't work; scroll the container.
7. All modals use `fixed inset-0 z-30 bg-[#000000B3] backdrop-blur-sm` backdrop — don't reinvent it.

---

## 18. Asset Checklist (to copy from the main repo)

To fully match branding, copy these files from the Gruve landing repo:

```
public/fonts/Satoshi-Regular.woff2
public/fonts/Satoshi-Medium.woff2
public/fonts/Satoshi-Bold.woff2
public/fonts/Satoshi-Black.woff2
public/gruve-logo.svg        (wordmark)
public/gruve-icon.svg        (favicon / app icon)
```

Plus from the source:

```
components/ui/button.tsx           (canonical button — §5)
components/ui/input.tsx            (canonical input — §6)
components/ui/textarea.tsx
shared/ModalElement/CenteredModal.tsx  (§7)
shared/ModalElement/FormModal.tsx      (§7)
shared/BottomSheet/BottomSheet.tsx     (§8)
shared/Svgs.tsx                        (icon set — §14)
lib/utils.ts                           (cn helper)
```

---

## 19. How to tell "this is Gruve"

A screenshot passes the sniff test if:

- [ ] Maroon `#ad112c` is the dominant accent, used sparingly (primary action + 1–2 highlights)
- [ ] Every button is pill-shaped (`rounded-full`)
- [ ] Every input is `rounded-lg`, every card is `rounded-2xl`
- [ ] Headings sit in Satoshi-900 or Satoshi-700; body is regular Satoshi
- [ ] No drop shadows on resting elements — only on hovered cards and overlays
- [ ] Backgrounds are white or `white-50`/`white-100`; never off-neutrals
- [ ] Focus rings are blue (`blue-500` at 30%), not brand-color
- [ ] Copy is sentence case, imperative, no emoji
- [ ] Motion is crisp 200–300ms, no bounce
