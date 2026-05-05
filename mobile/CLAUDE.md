# Mobile conventions

This codebase had a multi-PR standardization pass in 2026-05 (PRs #151–#154). The patterns below were established then. **Reach for the existing primitive before writing a new one** — most of the duplication that triggered the pass came from re-implementing patterns that already existed elsewhere.

## Design tokens — never typed pixel/font/opacity literals

Use the tokens in `src/theme/`. They're re-exported from `src/theme/index.ts`.

- **`spacing.*`** for padding/margin/gap. Scale: `hairline` (2), `xs` (4), `sm` (6), `md` (8), `base` (10), `lg` (12), `lg2` (14), `xl` (16), `xl2` (20), `xxl` (24), `xxxl` (32), `safeTop` (48). See `src/theme/spacing.ts`.
- **`fontSize.*`** for type sizes. Scale: `xs` (11), `sm` (12), `sm2` (13), `md` (14), `base` (15), `lg` (16), `lg2` (17), `xl` (18), `xxl` (20). See `src/theme/typography.ts`.
- **`radius.*`** for borderRadius. Scale: `sm` (6), `md` (8), `base` (10), `lg` (16). Same file.
- **`effects.*`** for opacity. `pressed` (0.5), `pressedSubtle` (0.6), `dimDisabled` (0.4). See `src/theme/effects.ts`.
- **`colors.scrim`** for modal backdrops.

The scales were derived from actual usage — they're not generic Tailwind. If a value isn't on the scale and is genuinely a one-off (a 28px hero title, an 11px circle radius for a 22px square, a 0.85 card-press dim), keep it inline with a `// why` comment. The rule is "no magic numbers", not "force everything onto the scale".

## API client — use `requestJson<T>`

New endpoints live in `src/api/<endpoint>.ts` and call `requestJson<T>` from `src/api/http.ts`:

```ts
return requestJson<EntryResponse>(`/entry/${teamId}`, {
  signal,
  mapStatus: (status) =>
    status === 404 ? new EntryNotFoundError(teamId) : undefined,
});
```

`mapStatus` also receives the parsed response body for endpoints that need to disambiguate same-status errors via body shape (see `transferSuggestions.ts` for the 404-with-body-discrimination case). Don't reimplement the `if (!res.ok) throw new Error(\`HTTP ${status}\`)` pattern.

## Hooks — `src/hooks/`

- **`useFetch<T>`** — single-fetcher state machine (loading/ok/error) with abort-on-unmount. The default for any data screen.
- **`useFocusedTeamId()`** — reads the user's FPL team id from storage on every screen focus. Returns `string | null | undefined` (the tri-state of "loading", "not set", "set"). Use whenever a screen needs the current team id; **don't roll your own** `let alive = true` + `getFplTeamId().then(...)` ceremony.
- **`useFocusedPlayersConfig()`** — bundles the columns/filters/sort load-on-focus + persisting setters shared between Players and My Team. Don't reimplement.
- **`useParallelFetch<K, T>(keys, fetcher)`** — sibling to `useFetch` for the per-key parallel pattern ("render placeholder rows immediately, fill in as fetches resolve"). Errors come through unwrapped on `state.error: unknown`; consumers branch on `instanceof DomainError` to derive the UI state. See `FriendsScreen.tsx`.

If you need team-id + a follow-on fetch (like Players' `ownedIds` re-resolve), it's fine to do that inline rather than forcing it through the team-id hook — those two cases are deliberately separate.

## Domain modules — single sources of truth

- **`src/players/positions.ts`** — FPL element_type metadata. `POSITION_CODES` (string codes), `POSITION_IDS` (numeric ids), `POSITIONS_WITH_LABELS` (id + code + display label). **Don't redefine** the position list in screen files.
- **`src/transfers/scoring.ts`** — `difficultyTone` / `eloTone` with named threshold constants (`DIFFICULTY_GOOD_MAX`, `ELO_GOOD_MIN`, etc.). Threshold tweaks happen here, not at call sites.
- **`src/format/rank.ts`** — `formatRank` / `formatInt` with named threshold constants for the M/k compaction logic.

## Dialogs — `src/components/dialog/`

New modal dialogs compose three primitives:

- **`DialogShell`** — Modal + WebShell + topBar with optional left action (Clear/Cancel) and required right action (Done/Apply). When `leftAction` is absent, the symmetric placeholder keeps the title centered.
- **`CheckRow`** — checkbox row primitive with optional `hint` line.
- **`Section`** — uppercase title + optional hint paragraph + body block with hairline borders.

`DialogShell` is scroll-agnostic: dialogs that need to scroll wrap their body content in a `ScrollView` themselves. Examples: `FilterDialog.tsx`, `ColumnPickerDialog.tsx`, `PositionFilterDialog.tsx` — each is a focused body wrapped in `<DialogShell>`.

**Don't reimplement** the modal+topBar+row chrome inline.

## Screen organization

Single-file screens are the default. Folder-based screens (`src/screens/<Name>/index.tsx` + sibling components + `styles.ts`) are reserved for large screens with many sub-components — currently `Transfers/` (formerly 1195L, 22 inline components) and `MyTeam/` (formerly 586L). Use them as templates if a screen grows past ~500 lines or ~10 sub-components.

When you split a screen into a folder, **co-locate the styles** in a single `styles.ts` (exporting `makeStyles`). Cross-references between siblings are dense; splitting styles per-component forces every padding tweak to span multiple files.

The navigation stack imports a screen folder directly: `import TransfersScreen from '../../screens/Transfers'` (Node resolves to `Transfers/index.tsx`).

## Lint and format

`npm run lint` (ESLint flat config) and `npm run format:check` (Prettier) gate the codebase. Run them before pushing. `npm run format` applies Prettier in place.

The rule set in `eslint.config.js` is intentionally minimal — `no-explicit-any`, `no-non-null-assertion` (warn), `consistent-type-imports`, `no-console`, `react-hooks/exhaustive-deps`. **Don't broaden it without discussing**: `no-magic-numbers` and `import/order` were considered and rejected because they'd flag thousands of context-legitimate violations and bury real signal.

## Path aliases — not yet wired

`@/*` aliases were considered for PR 3 and deferred. Use `../../` relative imports for now.
