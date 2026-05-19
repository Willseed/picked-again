# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — Angular dev server
- `npm run build` — production build
- `npm run build:pages` — GitHub Pages build (base href `/` for `https://pick.pylot.space/`)
- `npm run watch` — development watch build
- `npm test -- --watch=false` — full unit test suite (Vitest via `ng test`)
- `npm test -- --watch=false --include src/app/lottery/lottery-data.utils.spec.ts` — single spec file
- `npm run test:e2e` — Playwright mobile layout checks in Chromium and WebKit (first run may need `npx playwright install chromium webkit`)

## Architecture

Angular 21 standalone app. No NgModules anywhere — import Angular Material modules directly in each component's `imports` array.

**Entry chain:** `src/main.ts` → bootstraps `App` with `src/app/app.config.ts` (provides `HttpClient` with fetch, global error handler) → `App` renders a thin shell with `LotteryDashboardComponent`.

**Lottery domain** (`src/app/lottery/`):
- `lottery-data.model.ts` — data URL constant, formula constants, raw data shape, derived record types, grouped school results, and data-quality issue types
- `lottery-data.utils.ts` — pure functions: raw JSON validation, rate derivation, age-group sorting, school grouping, text normalization, fuzzy match scoring. **All lottery math lives here.**
- `lottery-data.service.ts` — Angular boundary: loads `assets/data.json` via `HttpClient`, delegates all transformation and search to the utils
- `lottery-dashboard.component.*` — Material UI: search form, loading/error/empty states, matched school cards with rate progress bars and 正取/備取 summaries

**Data:** runtime data comes from `public/assets/data.json`. The root `data.json` mirrors it — keep both in sync.

## Key Conventions

**Data shape:** `Record<schoolName, Record<ageGroup, { 正取, 備取 }> & { 搜尋關鍵字?: string[] }>`. The `搜尋關鍵字` field is school-level metadata (district aliases), not an age group — never treat it as one.

**Rate formula:** `正取 / (正取 + 備取)`. True applicant counts are unavailable. Zero denominator → `estimatedLotteryRate: null`, not `NaN`.

**Data quality:** invalid, missing, negative, non-integer, or non-numeric counts go into `dataQualityIssues`; derived counts fall back to `0`.

**Age-group sort order:** numeric age descending (`5歲`, `4歲`, `3歲`, `2歲專班`), then non-age labels by `zh-Hant` locale.

**Search normalization:** NFKC, `zh-Hant` lowercase, `臺`→`台`, strip whitespace/punctuation/symbols. Fuzzy scoring supports exact, substring, and ordered-subsequence matches.

**Component state:** Angular signals and `computed()` values; subscriptions use `takeUntilDestroyed`. Template-only members are `protected readonly`.

**Tests:** data-utility tests use `satisfies RawLotteryData`; component tests stub `LotteryDataService` — no real HTTP.

**Mobile layout:** changes to sequence chips or year navigation require Playwright validation in mobile Chromium and mobile WebKit. Keep sequence chip grids on `minmax(0, 1fr)` tracks and set Material chip internals (`.mdc-evolution-chip*`) to `min-width: 0` so WebKit/Chrome do not overflow.

**Year navigation controls:** keep the year buttons icon-only, 44px touch targets, inside the data card as a full-width row with `justify-content: space-between`; do not restore visible `上一年` / `下一年` text.

**Every new school entry requires a test:** whenever a school is added to `data.json` / `public/assets/data.json`, add a matching `it` block in `lottery-data.utils.spec.ts` in the same commit that verifies:
- `estimatedLotteryRatePercent` for every age group (via `toBeCloseTo`)
- at least one school-specific search keyword (short name or unique alias) produces an exact match (`matchScore === 1`)

## Visual Style

`DESIGN.md` is the source of truth. The target is a Raycast-inspired dark command-palette UI, not Material's default light theme.

- **Dark-only.** Page background `#07080a`, surface ladder `#0d0d0d` → `#101111` → `#121212`. No light variant.
- **Elevation via surface ladder + 1px hairline borders** (`#242728` normal, `rgba(255,255,255,0.16)` strong). No drop shadows.
- **Primary action:** white pill (`{colors.primary}` on `{colors.on-primary}`). Saturated accents (`accent-yellow/red/green/blue`) belong only in illustration moments, never on chrome, buttons, or text.
- **Typography:** Inter with `font-feature-settings: "calt", "kern", "liga", "ss03"` on the body element. The `ss03` alternate `g` is the brand signature — don't omit it.
- **Radii:** 6px keycap/small, 8px inputs/buttons/small cards, 10px feature cards, 16px large hero containers only.
- **Hero red diagonal stripe gradient** (`#ff5757` → `#a1131a`): top hero band only, once per page maximum.
- **Section rhythm:** 96px desktop → 64px tablet → 48px mobile.
- UI controls stay on Angular Material (`mat-card`, `mat-form-field`, `mat-chip`, `mat-progress-bar`, etc.) but are styled to match the dark command-palette system.
