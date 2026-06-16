# Bean Counter UI Redesign Proposal — Tailwind CSS v4, Dark-First

**Status:** Draft for pre-implementation review
**Author:** AI agent (orchestrator)
**Date:** 2026-06-16

## 1. Goal

Redesign the Bean Counter frontend onto a **different CSS framework** and make a
**dark theme the default**, while keeping all existing Svelte 5 component
structure, behavior, routing, accessibility semantics, and API wiring intact.

This is a styling/presentation migration. No `.ts` logic, API client, route
parsing, or graph layout math changes.

## 2. Current state (baseline)

- **Stack:** Svelte 5 (`$state`/`$derived`/`$props`/snippets) + Vite 8 + TypeScript, built to static assets, served by Nginx, proxying `/api` to a Go/Fiber backend.
- **Styling:** ~526 lines of hand-written custom CSS in `frontend/src/app.css`, plus a scoped `<style>` block inside `GraphRoute.svelte` (lines 163–310). No framework, no CSS variables, **light theme only** (off-white `#f6f7f4`, forest-green `#245942` accents).
- **Markup:** Class-based (`.shell`, `.sidebar`, `.workspace`, `.toolbar`, `.issue-row`, `.ready-row`, `.status-pill`, `.graph-node`, etc.). Semantic elements (`<aside>`, `<main>`, `<nav>`, `<dl>`, `<article>`) are already used well.
- **Views:** Issues (`/`, list + detail/create/edit panel + dependency editor), Ready (`/ready`), Graph (`/graph`, inline SVG).
- **Shared components:** `AppShell`, `EmptyState`, `ErrorState`, `LoadingState`.

## 3. Framework decision

**Chosen: Tailwind CSS v4** via the first-party `@tailwindcss/vite` plugin.

### Why Tailwind v4 (vs. alternatives considered)

| Option | Verdict |
|--------|---------|
| **Tailwind CSS v4** | ✅ Chosen. First-party Vite plugin (no PostCSS config), CSS-first `@theme` config, trivial dark mode via a `dark` variant bound to `[data-theme]`, utility classes co-locate styling with the markup we're already editing. Idiomatic for Svelte+Vite in 2026. |
| Pico CSS / classless | ❌ App relies on bespoke grid layouts (`.shell`, `.issues-layout`, `.graph-content`); a classless semantic framework can't express them without heavy custom CSS, defeating the purpose. |
| Bootstrap 5 | ❌ jQuery-era utility/component split, heavier, less idiomatic with Svelte, dark mode is `data-bs-theme` but the component CSS is opinionated and would fight the existing custom layouts. |
| Bulma | ❌ Sass-based, no first-class Vite/dark story as clean as Tailwind v4. |
| Open Props only | ❌ Variables without utilities; we'd still hand-write all layout CSS. |

### Dependencies added

```
devDependencies:
  tailwindcss        ^4
  @tailwindcss/vite  ^4
```

`vite.config.ts` gains the `tailwindcss()` plugin alongside `svelte()`. No
PostCSS file needed.

## 4. Theme system (dark default)

Dark is the default and the app also honors a light theme so the work is
genuinely a *theme system*, not a hardcoded recolor.

- `index.html` `<html>` gets `data-theme="dark"` and `class="dark"` inline (before paint, no FOUC).
- `app.css` becomes the Tailwind entrypoint:

```css
@import 'tailwindcss';

/* dark is driven by an attribute we control, not the OS, so dark stays default */
@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@theme {
  /* semantic tokens — referenced by utilities like bg-surface, text-muted */
  --color-canvas:    #0f1511;  /* app background (dark) */
  --color-surface:   #161d18;  /* cards / panels */
  --color-surface-2: #1d261f;  /* sidebar, hover */
  --color-border:    #2b362d;
  --color-text:      #e7ece8;
  --color-muted:     #8fa094;
  --color-primary:   #34d399;  /* emerald 400 — accessible on dark */
  --color-primary-fg:#06231a;
  --color-danger:    #f87171;
  --color-danger-fg: #2a0d0d;
}
```

> Token values are illustrative; final palette tuned for WCAG AA contrast
> (text ≥ 4.5:1 on canvas/surface, primary button text ≥ 4.5:1).

**Light theme:** an optional override block keyed on `[data-theme='light']`
remaps the same tokens to a light palette (preserving the original
green-on-cream feel). Because every component consumes *semantic tokens* rather
than raw colors, switching themes is a single attribute flip. A theme toggle in
the sidebar is **in scope as a stretch**; the hard requirement is dark-default.

## 5. Migration approach

**Strategy: token-backed utilities, mechanical per-component conversion.**

For each component, replace the custom class with Tailwind utilities that
reference the semantic tokens (e.g. `class="issue-row"` →
`class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 min-h-16 border-b border-border px-3.5 py-3 text-left hover:bg-surface-2 ..."`).
Repeated patterns (pills, primary/secondary/danger buttons, panel cards) are
extracted into small Svelte snippet/components or `@utility` shortcuts to avoid
class soup and keep one source of truth.

### Per-file plan

1. **`index.html`** — add `data-theme="dark" class="dark"` on `<html>`; set `color-scheme`.
2. **`src/app.css`** — replace all 526 lines with the Tailwind entry + `@theme` tokens + a few `@utility` shortcuts (`btn`, `btn-secondary`, `btn-danger`, `pill`, `card`, `field`).
3. **`AppShell.svelte`** — shell grid, sidebar, brand mark, nav links, topbar → utilities.
4. **`EmptyState` / `ErrorState` / `LoadingState`** — state panel + spinner (spinner via `animate-spin`, respects `motion-reduce`).
5. **`IssuesRoute.svelte`** — toolbar, issue list rows, detail/create/edit form, dependency editor, pills, actions.
6. **`ReadyRoute.svelte`** — queue summary, ranked rows, rank badge, pills.
7. **`GraphRoute.svelte`** — convert the inline `<style>` block; SVG node/edge fills move to token-driven utility classes or CSS vars so the graph is legible on dark.
8. **`routes.ts` / `*.ts` / `main.ts`** — unchanged (logic only).

### Invariants (must NOT change)

- All `aria-*`, `role`, `aria-label`, `aria-current`, `aria-hidden` attributes preserved exactly.
- All event handlers, `bind:`, `class:active`/`class:selected` reactive bindings preserved (mapped to conditional utility classes where needed).
- Snippet props (`title`, `children`) and component contracts unchanged.
- DOM element types and nesting preserved (so existing `*.test.ts` and behavior hold).
- Responsive breakpoints preserved (mobile single-column at ~760px, graph stacking at ~900px) via `max-md:`/`max-lg:` or `@media` parity.
- Reduced-motion handling preserved.

## 6. Accessibility & quality bar

- WCAG AA contrast on the dark palette (verify primary/danger button text, muted text, pills).
- Visible focus states (`focus-visible:ring`) — current design has weak focus affordance; this is an improvement opportunity.
- `color-scheme: dark` so native controls (scrollbars, date pickers) render dark.
- Keyboard interaction on graph nodes (`tabindex`, Enter/Space) preserved.

## 7. Verification plan

1. `npm run check` (svelte-check + tsc) — zero errors.
2. `npm run build` — clean production build.
3. `npm run test` (vitest) — existing tests pass unchanged.
4. Manual/visual smoke of all three routes in dark mode (and light if toggle landed).
5. Two post-implementation subagent reviews (parallel) before completion sign-off.

## 8. Risks & mitigations

- **Class soup / unreadable markup** → mitigated by `@utility` shortcuts for repeated patterns.
- **SVG graph colors** → handled explicitly in step 7; tokens applied to fills/strokes.
- **Contrast regressions** → AA check as a gate.
- **Behavioral drift from markup edits** → invariants list + test suite + `class:` binding parity.
- **Tailwind v4 content detection** → v4 auto-detects; confirm Svelte files are scanned (they are, via the Vite plugin).

## 9. Out of scope

Backend, API shapes, Nginx, Docker, graph layout algorithm, adding new features
or views. Pure presentation-layer redesign.
