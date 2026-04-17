# PULSE Dark Theme Spec

Companion to `GRUVE-DESIGN.md`. The Gruve doc is the canonical light spec; this file documents how PULSE renders in dark mode and the rules for keeping new code theme-clean.

Dark mode is **opt-in** (light is the default). Users toggle via Settings → Appearance.

---

## 1. How activation works

| Layer | Where | What it does |
|---|---|---|
| Inline script | `src/components/theme/ThemeScript.tsx`, rendered in `<head>` of root layout | Reads `localStorage["pulse-theme"]`. Adds `class="dark"` to `<html>` only if value is `"dark"`. Runs before first paint, no flash. |
| Switcher | `src/components/theme/ThemeSwitcher.tsx`, mounted in Settings → Appearance | Light/Dark pill toggle. Writes the same localStorage key + flips the class. |
| CSS | `html.dark { ... }` block in `src/app/globals.css` | Overrides every relevant CSS variable. |

There is no React context or server-side persistence. The choice lives only in the user's browser.

---

## 2. Token strategy

The Gruve light palette is declared once in the `@theme` block. Inside `html.dark { }` we **redeclare every token** that needs to change in dark. Tailwind utilities reference the same variable name, so `bg-card`, `text-gray-1100`, `border-white-200`, `bg-primary-50`, etc. all flip automatically.

Two reasons to prefer this over `dark:` Tailwind variants in component code:
1. The 40+ existing module pages don't need touching.
2. Designers and reviewers can see the entire dark palette in one place.

`dark:` variants are still fine when one element legitimately needs different *layout* in dark, not just a different color value.

---

## 3. Dark palette

All values from `globals.css` `html.dark` block. Every override is intentional.

### Surfaces
| Token | Value | Where it shows |
|---|---|---|
| `--background` | `#0c0d14` | Page bg (slightly warmer than pure black for soft tone) |
| `--sidebar` | `#111219` | Left nav, mobile header, intel-feed right panel |
| `--card` | `#181923` | Card primitive (`bg-card`), auth cards, settings sections |
| `--card-hover` | `#23252f` | Hover lift on interactive cards |
| `--border` | `#2f3142` | Default stroke. Bumped from `#2a2a3a` to stay perceptible without harshness |

### Text
| Token | Value | Use |
|---|---|---|
| `--foreground` | `#e9eaf1` | Body — off-white, softer than pure `#fff` |
| `--text-secondary` | `#b4b7c6` | Sub-headings, secondary copy |
| `--text-muted` | `#8b8ea3` | Captions, helper text. Passes AA on dark surfaces |

### Brand (Gruve maroon, dark-tuned)
The light brand is `#ad112c` — too dark to read on a dark canvas. Dark mode brightens to `#c7434e` for buttons and `#ea445a` for accents.

| Token | Value | Use |
|---|---|---|
| `--color-primary-50` | `rgba(234,68,90,0.12)` | Pill / chip / nav-active bg tint |
| `--color-primary-100` | `rgba(234,68,90,0.20)` | Stronger tint |
| `--color-primary-300` | `#f39b9b` | Lighter accents |
| `--color-primary-400` | `#d85a64` | |
| `--color-primary-500` | `#c7434e` | **Default CTA bg + brand text.** AA-passes on `#0c0d14` |
| `--color-primary-600` | `#b5313b` | Hover (slight darken) |
| `--color-primary-700` | `#a52833` | Active |
| `--color-primary-1000` | `#ea445a` | Warm-red accent (notification bell, gradient end-stop) |

`--purple` and `--pink` (back-compat vars used by the legacy `gradient-purple-pink` utility and `Logo`'s dark gradient) also map into the red family — Logo dark gradient is `#c7434e → #ea445a`, not violet/pink.

### Gray scale (inverted)
The Gruve light palette uses gray-1100 / 1200 as near-black headings and body. In dark we invert:

| Token | Light | Dark |
|---|---|---|
| `gray-50` | `#f6f7f7` | `#181923` (acts as a card) |
| `gray-100` | `#e3e3e4` | `#23252f` |
| `gray-500` | `#717477` | `#8b8ea3` |
| `gray-600` | `#4f5153` | `#b4b7c6` |
| `gray-1000` | `#666481` | `#8b8ea3` |
| `gray-1100` | `#111021` | `#f5f6fa` |
| `gray-1200` | `#2d2b4a` | `#e9eaf1` |

Practical effect: a heading written as `text-gray-1100` reads as near-black in light and near-white in dark, no per-component changes needed.

### Whites (inverted to dark surfaces)
`white-50..700` are repointed to dark surface values so utilities like `bg-white-50` and `border-white-200` stay correct in dark.

| Token | Light | Dark |
|---|---|---|
| `white-50` | `#fbfbfd` | `#181923` |
| `white-100` | `#f2f2f6` | `#1e1f2a` |
| `white-200` | `#e1e1e8` | `#2f3142` (matches `--border`) |

### Semantics
| Token | Value | Notes |
|---|---|---|
| `success-500` | `#4ade80` | Brighter green for dark legibility |
| `success-1000` | `rgba(74,222,128,0.12)` | Pill bg tint |
| `warning-500` | `#facc15` | |
| `warning-50` | `rgba(250,204,21,0.12)` | |
| `error-500` | `#f87171` | Softer than light's `#ff2e00` |

### Blue (focus rings)
| Token | Value |
|---|---|
| `blue-500` | `#60a5fa` (brighter for dark visibility) |
| `blue-50` | `rgba(96,165,250,0.14)` |

Focus rings stay blue in both themes (per Gruve §3 — never use brand color for focus).

---

## 4. Logo behavior

`src/components/ui/Logo.tsx`:

```tsx
<span className="text-primary-500 dark:bg-gradient-to-r dark:from-accent-purple dark:to-accent-pink dark:bg-clip-text dark:text-transparent">
  PULSE
</span>
```

- Light: flat maroon `text-primary-500` (`#ad112c`)
- Dark: gradient via `bg-clip-text` from `--purple` → `--pink`, both of which now resolve to red shades

Bold italic via `font-extrabold italic` (since the Satoshi font files aren't checked in yet, this falls through to system bold-italic).

---

## 5. Author rules — keeping new code theme-clean

### Use these (theme-aware)
| Want | Class |
|---|---|
| Card surface | `bg-card` |
| Page bg | `bg-background` |
| Subtle hover | `hover:bg-card-hover` |
| Default border | `border-border` (or `border-white-200`) |
| Body text | `text-foreground` or `text-gray-1200` |
| Muted text | `text-text-muted` or `text-gray-1000` |
| Brand fill | `bg-primary-500` |
| Brand text | `text-primary-500` |
| Brand chip | `bg-primary-50 text-primary-500` |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-blue-500/30` |

### Don't use these (NOT theme-aware)
| Footgun | Why | Use instead |
|---|---|---|
| `bg-white` | Literal `#fff` in both themes — white card on dark page | `bg-card` |
| `text-white` | Literal `#fff` — invisible on white | `text-foreground` (keep `text-white` only when the bg is a colored fill: maroon button, gradient pill, etc.) |
| `bg-black` | Same problem inverted | `bg-background` (or hardcoded `bg-[#000000B3]` for the modal backdrop, which is intentional per Gruve §7) |

### Existing intentional `text-white` usages
- `components/ui/button.tsx` — default + destructive variants (white-on-maroon / white-on-error)
- `components/ui/Badge.tsx` — `gradient` variant (white-on-maroon)
- `components/sidebar/TenantSwitcher.tsx` — active workspace avatar (white-on-maroon)
- `components/theme/ThemeSwitcher.tsx` — active toggle pill (white-on-maroon)

If you change one of these, make sure the bg behind the text is still colored.

---

## 6. Strokes

Light borders are `#eceff2` (softened from spec's `white-200 #e1e1e8`). Dark borders are `#2f3142`. Both are intentionally soft — visible but not heavy. If you need stronger separation, add elevation (`shadow-custom-100`) before reaching for a darker border.

Modal/sheet backdrops use the spec value `#000000B3` + `backdrop-blur-sm` in both themes.

---

## 7. Motion + interaction

Same as Gruve light:
- 200–300ms transitions, no bounce
- Hover lifts only on cards (`hover:shadow-custom-100`)
- Focus rings: blue at 30% opacity

---

## 8. QA quick-checklist before shipping a page

1. Toggle Settings → Appearance and confirm both themes look correct.
2. Spot-check: card backgrounds, body text, muted text, primary CTA, hover state, focus ring, badges/pills.
3. Grep the new file for `bg-white\b`, `text-white\b`, `bg-black`, `bg-\[#` to catch hardcoded colors.
4. Take two screenshots (light + dark) for the PR description.
