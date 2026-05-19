# Copilot instructions for picked-again

## Commands

- Install dependencies: `npm install`
- Start the Angular dev server: `npm start`
- Production build: `npm run build`
- GitHub Pages custom-domain build: `npm run build:pages` (root `/` base href for `https://pick.pylot.space/`)
- Development watch build: `npm run watch`
- Full unit test suite: `npm test -- --watch=false`
- Single spec file: `npm test -- --watch=false --include src/app/lottery/lottery-data.utils.spec.ts`
- Playwright mobile layout checks: `npm run test:e2e` (runs mobile Chromium and WebKit; first-time setup may need `npx playwright install chromium webkit`)

This project uses npm (`packageManager`: `npm@11.12.1`) and Angular CLI 21.

## Architecture

- The app is an Angular 21 standalone application. `src/main.ts` bootstraps `App` with providers from `src/app/app.config.ts`; `app.config.ts` enables browser global error listeners and `provideHttpClient(withFetch())`.
- `App` is intentionally thin: it renders the top Material toolbar and imports `LotteryDashboardComponent`.
- The lottery domain lives under `src/app/lottery/`:
  - `lottery-data.model.ts` defines the data URL, formula constants, raw data shape, derived records, grouped school results, and data-quality issue types.
  - `lottery-data.utils.ts` contains pure transformation/search logic: raw JSON validation, rate derivation, age sorting, school grouping, text normalization, and fuzzy match scoring.
  - `lottery-data.service.ts` is the boundary between Angular and the pure logic. It loads `assets/data.json` through `HttpClient` and delegates transformation/search to the utils.
  - `lottery-dashboard.component.*` owns the Material UI: search form, loading/error/empty states, matched school cards, rate progress bars, and 正取/備取 summaries.
- Runtime data is loaded from `public/assets/data.json` via `LOTTERY_DATA_URL`. The root `data.json` mirrors the same source data; keep both in sync unless a copy/sync step is added.
- `angular.json` copies all files from `public/` as build assets, including `public/CNAME` for GitHub Pages, and uses `@angular/build:unit-test` for Vitest-based unit tests.

## Visual style

Use `DESIGN.md` as the source of truth for visual work. The target is a Raycast-inspired dark command-palette interface, not Angular Material's default light dashboard.

- Keep the whole app in a single dark surface mode: `{colors.canvas}` `#07080a` for the page, then `{colors.surface}` `#0d0d0d`, `{colors.surface-elevated}` `#101111`, and `{colors.surface-card}` `#121212` for cards and nested panels.
- Build elevation with the surface ladder and 1px hairline borders (`{colors.hairline}` `#242728`, `{colors.hairline-strong}` for emphasis). Do not use drop shadows for depth.
- Primary actions use a white pill (`{colors.primary}` on `{colors.on-primary}`); saturated accents belong only in illustration/detail moments, not core chrome, text, or buttons.
- Typography should follow the Inter-based system from `DESIGN.md`, including `font-feature-settings: "calt", "kern", "liga", "ss03"` on the body. Use the documented display/heading/body scale instead of Material defaults when styling custom shells.
- Keep radii tight: 6px for small/keycap-like details, 8px for inputs/buttons/small cards, 10px for feature cards, and 16px only for large hero/mockup containers.
- Map the current Material UI onto `DESIGN.md` components: dashboard hero/results cards should read like `command-palette-card` or `feature-card-dark`; the search field should read like `store-search-bar`; count/rate chips should follow `pill-tab`/badge treatments.
- If adding a hero treatment, reserve the red diagonal stripe gradient for the top hero band only, once per page.
- Keep responsive layouts aligned with `DESIGN.md`: generous desktop spacing, single-column mobile collapse, and section padding stepping down from 96px to 64px to 48px.

## Project-specific conventions

- Use standalone components and import Angular Material modules directly in each component `imports` array; there are no NgModules.
- Keep lottery math and fuzzy search in `lottery-data.utils.ts`. Components should call `LotteryDataService` instead of duplicating rate or matching logic.
- The source data shape is `Record<schoolName, Record<ageGroup, { 正取, 備取 }> & { 搜尋關鍵字?: string[] }>`; `搜尋關鍵字` is school-level metadata for district aliases and must not be treated as an age group. The displayed estimated rate is `正取 / (正取 + 備取)` because true applicant counts are not present.
- Search normalization is deliberate: NFKC normalization, `zh-Hant` lowercase, `臺` to `台`, and removal of whitespace/punctuation/symbols. Fuzzy matching supports exact, substring, and ordered-subsequence matches with scores.
- Invalid, missing, negative, non-integer, or non-numeric counts should become `dataQualityIssues`; derived counts fall back to `0`, and zero denominators produce `estimatedLotteryRate: null` rather than `NaN`.
- Age groups sort by numeric age descending (`5歲`, `4歲`, `3歲`, `2歲專班`), with non-age labels sorted by `zh-Hant` locale.
- Component state uses Angular signals/computed values and `takeUntilDestroyed` for subscriptions. Component members used only by templates are `protected readonly`.
- UI surfaces and controls should stay on Angular Material components (`mat-card`, `mat-form-field`, `mat-chip`, `mat-progress-bar`, Material buttons/icons), but style them toward the `DESIGN.md` dark command-palette system instead of accepting default Material chrome.
- Unit tests use Vitest through `ng test`. Data utility tests use `satisfies RawLotteryData`; component tests stub `LotteryDataService` rather than performing real HTTP requests.
- Mobile layout changes, especially around sequence chips or year navigation, must be validated with Playwright in both mobile Chromium and mobile WebKit. Sequence chip grids must avoid WebKit/Chrome overflow by keeping grid tracks at `minmax(0, 1fr)` and forcing Material chip internals (`.mdc-evolution-chip*`) to `min-width: 0`.
- Year navigation buttons should remain icon-only, 44px touch targets, inside the data card as a full-width control row using `justify-content: space-between`; do not reintroduce visible `上一年` / `下一年` labels.
- **Every new school entry must be accompanied by a test**: add an `it` block in `lottery-data.utils.spec.ts` that verifies `estimatedLotteryRatePercent` for every age group (via `toBeCloseTo`) and that at least one school-specific search keyword produces an exact match (`matchScore === 1`). Data and tests must land in the same commit.
