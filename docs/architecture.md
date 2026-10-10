# Architecture

How FPL Stats is put together, as of October 2026 (after PR #189). For the clickable version with animated data-flow scenarios, open the [Field Guide](artifacts/README.md).

## The big picture

```
                         ┌───────────────────── EventBridge (4 rules, UTC) ─────────────────────┐
                         │ every 30 min        Sun 02:00             daily 04:00     daily 04:30 │
                         ▼                     ▼                     ▼               ▼
 FPL API ───────► ingest_fpl         ingest_player_history   analyze_player_form  analyze_player_xp_v2
 (public)            │    │                   │                     │  ▲               │  ▲
                     │    └──► S3 snapshots   │                     ▼  │               ▼  │
                     └──────────────────────► DynamoDB CacheTable ◄────┴───────────────────┘
                                                   ▲          ▲
                                   cache only      │          │ cache-aside (refetch from FPL on a miss)
                                                   │          │
 Expo app (web via Amplify, iOS, Android) ──► API Gateway HTTP API ──► 10 read Lambdas

 CloudWatch Errors alarms (5) ──► SNS IngestionAlertsTopic ──► email
```

Three principles hold throughout:

1. **The app only talks to our API.** FPL rate-limits and 403s anything that looks scripted, so every FPL call happens server-side through `make_fpl_session()` (browser User-Agent plus retries) in the shared layer.
2. **Shared data is precomputed; per-team data is cached on demand.** Players, fixtures, form and xP are written by schedules and read straight from DynamoDB. A manager's entry, picks and leagues are fetched from FPL on a cache miss and kept for 30 minutes.
3. **Stale beats down.** If an ingest fails, the read routes keep serving the last good cache. Alarms tell you; users don't notice.

## Infrastructure

Everything lives in one CDK stack, `FplStatsStack` (`backend/lib/fpl-stats-stack.ts`), except the Amplify web hosting, which was set up in the console.

| Resource | Configuration | Notes |
| --- | --- | --- |
| DynamoDB `CacheTable` | `pk` (S) + `sk` (S), on-demand, TTL attribute `ttl`, `RemovalPolicy.DESTROY` | Single-table design, no GSIs. Every read knows its key. |
| S3 `SnapshotsBucket` | Versioned, Block Public Access, SSE-S3, `enforceSSL`; Standard → Standard-IA at 30 days, delete at 90 | Raw FPL payloads, never on the request path. |
| Lambda layer `fpl_schemas` | `backend/layers/fpl_schemas/python/` | Attached to every Lambda except `health`. |
| API Gateway HTTP API | 10 `GET` routes, CORS `*` for GET/OPTIONS, no authorizer; `$default` stage throttled to 20 req/s, burst 40 | Throttle set through a `CfnStage` escape hatch, because CDK only exposes `throttle` on stages added with `addStage()`. |
| EventBridge | 4 rules (below) | Cron times are UTC. |
| CloudWatch | One log group per Lambda (1-week retention), 5 `Errors` alarms | All alarms publish to the SNS topic. |
| SNS `IngestionAlertsTopic` | One email subscription | |
| Amplify Hosting | Builds `mobile/` with `npx expo export -p web` per `amplify.yml` | Not in CDK. Custom domain deferred (#162). |

Stack outputs: `ApiBaseUrl`, `CacheTableName`, `SnapshotsBucketName`, `IngestFplFunctionName`. `npm run deploy` writes them to `backend/.deploy-outputs.json`.

### Lambda defaults

`FplPythonFunction` (`backend/lib/fpl-python-function.ts`) wraps `PythonFunction` with the project defaults: Python 3.12, **1024 MB**, 10 s timeout, explicit one-week log group. 1024 MB is deliberate: Lambda allocates CPU in proportion to memory, and at 128 MB the read handlers took 2–5 s for 0.3 s of real work (see [performance](performance.md)). A jest test fails if a read-API function drops below the default.

## Background jobs

| Lambda | Schedule (UTC) | Memory / timeout | What it does |
| --- | --- | --- | --- |
| `ingest_fpl` | every 30 min | 256 MB / 60 s | Fetches `bootstrap-static` and `fixtures` (both or nothing). Writes raw JSON to S3 first, then a slim pydantic-validated subset to `fpl#bootstrap` and `fpl#fixtures`. |
| `ingest_player_history` | Sun 02:00 | 256 MB / 5 min | Calls `element-summary/{id}` for every player (~700, 50 ms apart). Replaces each player's history rows and deletes ids no longer in bootstrap, which is how the yearly id renumbering is handled (#158). |
| `analyze_player_form` | daily 04:00 | 256 MB / 60 s | Rolling form over the last 5 GWs and difficulty of the next 5 fixtures (FPL's difficulty rating; ClubELO was dropped in #167). Still calls FPL's `event/{gw}/live` directly (#150). |
| `analyze_player_xp_v2` | daily 04:30 | 512 MB / 60 s | Skips if any match kicked off in the last 2 hours (`match_window.py`). Otherwise scans ~21k history rows and writes xP for the next 5 gameweeks whose deadline is still ahead. See [xP model](xp-model.md). |

The analyzers are chained by clock, not by events: they assume the Sunday ingest finished because they run hours later. Step Functions would make that explicit (#40).

Every writer **prunes what it didn't produce** (`ddb_prune` in the layer): departed players, blanking teams and last season's ids disappear instead of lingering as stale rows.

## DynamoDB key shapes

| `pk` | `sk` | Written by | Read by | Freshness |
| --- | --- | --- | --- | --- |
| `fpl#bootstrap` | `latest` | `ingest_fpl` | almost everything | ≤ 30 min |
| `fpl#fixtures` | `latest` | `ingest_fpl` | `gameweek_current`, match-window guard, analyzers, transfers | ≤ 30 min |
| `fpl#player_history#{id}` | `gw#{round:03d}#fixture#{fixture}`, `season_summary#{season}` | `ingest_player_history` | xP analyzer, transfers, offline fit scripts | weekly |
| `analytics#player_form` | `{player_id}` | `analyze_player_form` | `analytics_player_form`, transfers | daily |
| `analytics#player_xp_v2` | `{player_id}` | `analyze_player_xp_v2` | `analytics_players_xp`, transfers | daily |
| `entry#{teamId}` | `latest` | `entry`, transfers | same | TTL 30 min |
| `entry#{teamId}#gw#{gw}` | `latest` | `entry_gameweek`, transfers | same | TTL 30 min |
| `entry#{teamId}#history` | `latest` | transfers | transfers | TTL 30 min |
| `gameweek#{gw}#live` | `latest` | `gameweek_live` | `gameweek_live` | TTL 30 min |
| `league#{leagueId}` | `latest` | `league_members` | `league_members` | TTL 30 min |

Things worth knowing:

- `fpl#bootstrap` is the one item nearly every Lambda reads. Its gameweek **deadlines** decide "current" and "next" everywhere (#173, #174), rather than FPL's `is_current` flag, which reaches the cache up to 30 minutes late.
- The zero-padded round in history sort keys (`gw#007`) keeps them in numeric order.
- Cache-aside items carry both `expires_at` (checked in code) and `ttl` (DynamoDB's background deletion, which can lag by days).
- A missing `analytics#player_xp_v2` row means "no fixture in the horizon", so the analyzer deletes rows for blanking players instead of leaving last week's.
- Every item carries `schema_version` and `fetched_at`. Bump `SCHEMA_VERSION` in the layer when a cached shape changes incompatibly.
- DynamoDB items cap at 400 KB, which is why the full bootstrap lives only in S3 and the table holds a parsed subset. Floats must be converted to `Decimal` before `put_item`, and boto3 returns `Decimal` on read.

## API routes

All routes are `GET`. Lambdas marked **cache-aside** call FPL on a miss; the rest read only the cache, so an FPL outage can't break them.

| Route | Lambda | Type | Used by |
| --- | --- | --- | --- |
| `/health` | `health` | no table access | nothing in the app; smoke tests |
| `/gameweek/current` | `gameweek_current` | cache only | every tab (gameweek banner, ● / ✓ markers), Gameweek fixtures screen |
| `/players` | `players` | cache only | My Team, Players, Transfers, Friend Team |
| `/entry/{teamId}` | `entry` | cache-aside, 15 s timeout | My Team, Players, Friends |
| `/entry/{teamId}/gameweek/{gw}` | `entry_gameweek` | cache-aside, 15 s | My Team, Players, Friend Team |
| `/gameweek/{gw}/live` | `gameweek_live` | cache-aside, 15 s | My Team, Players, Friend Team |
| `/league/{leagueId}/members` | `league_members` | cache-aside, 15 s | Friends → Import league |
| `/analytics/player/{id}/form` | `analytics_player_form` | cache only | nothing in the app yet |
| `/analytics/players/xp` | `analytics_players_xp` | cache only | xP column on My Team and Players, suggested lineup |
| `/analytics/squad/{teamId}/transfers` | `analyze_transfer_suggestions` | cache-aside, 1024 MB / 30 s | Transfers |

`/analytics/players/xp` corrects precomputed data at read time: the analyzer runs once a day, so the handler reads `fpl#bootstrap` and drops any gameweek whose deadline has passed since. xP moves on at the deadline rather than the next morning.

`/analytics/squad/{teamId}/transfers` is the only heavy work on the request path. It derives free transfers from the manager's history (25/26 rules: bank up to 5, Wildcard and Free Hit preserve them), builds 1- to 3-move bundles, subtracts 4 points per transfer beyond the free count, and ranks by net ΔxP. Query parameters:

| Param | Default | Meaning |
| --- | --- | --- |
| `horizon` | 3 (max 5) | Gameweeks to sum xP over, starting at the next open deadline. |
| `max_transfers` | 2 (max 3) | Largest bundle size considered. |
| `free_transfers` | derived | Overrides the derived count, e.g. after transfers the public history doesn't show yet. The derived count is still returned as `derived_free_transfers`. |
| `positions` | all | Comma-separated FPL `element_type` ids (1 GK, 2 DEF, 3 MID, 4 FWD). |

API Gateway's integration timeout is capped at 30 s, so the transfers Lambda's timeout is already at the ceiling.

## The shared layer

`backend/layers/fpl_schemas/python/` holds everything more than one Lambda needs:

| Module | Purpose |
| --- | --- |
| `schemas` | pydantic models for FPL payloads, plus `SCHEMA_VERSION`. |
| `fpl_session` | `make_fpl_session()`: browser User-Agent and retries, so FPL doesn't 403 us. |
| `match_window` | "Is a match live?" (kickoff to +2 h), used to skip analyzer runs. |
| deadline helpers | `open_gameweek_ids`, `current_and_next_gameweek`, `utc_now`. Every "which gameweek?" question goes through these. |
| `ddb_prune` | Deletes rows a writer didn't produce this run. |
| `xp_compute`, `xp_v2`, `xp_v2_features` | The xP maths. |
| `xp_v2_coefficients.json`, `xp_v2_priors.json` | Fitted weights and priors, produced offline by `backend/scripts/fit_xp_v2.py`. |

The layer has its own pytest suite (`backend/layers/fpl_schemas`), run in CI.

## The app

One Expo (React Native + TypeScript) codebase, exported for web and hosted on Amplify. Most use today is the installed web app (PWA) on Android.

| Tab | Screens | Calls |
| --- | --- | --- |
| My Team | Pitch / List views, Yours vs Suggested lineup, Gameweek fixtures screen (from the banner) | entry → picks → live points, plus players, xP, gameweek |
| Players | Sortable, filterable pool with removable filter chips; your players dimmed | players, xP, your team (to dim owned players), gameweek |
| Transfers | Ranked bundle cards with bank and hit pills; horizon, max transfers and free-transfer controls | transfers, players, gameweek |
| Friends | Friends list, add by team id, import a classic league, manage, tap a friend to see their squad | one `/entry` per friend, league members, picks/live for Friend Team |
| Settings | Team id, theme (light / dark / system) | gameweek (banner only) |

Client-side plumbing worth knowing (details in [`mobile/CLAUDE.md`](../mobile/CLAUDE.md)):

- **TanStack Query** caches every endpoint and persists it to AsyncStorage (#184), so a reopened app renders its last data instantly and refreshes in the background. Live data goes stale after 1 minute, ingested data after 5. Bump `PERSISTED_CACHE_VERSION` in `src/query/client.ts` when a response shape changes incompatibly.
- Transient API errors are retried (#185).
- All requests go through `requestJson<T>()` in `src/api/http.ts`. The base URL comes from `API_BASE_URL` at bundle time via `app.config.ts`.
- Team id, friends list, column and filter choices live in AsyncStorage on the device. There is no account system and no FPL login.
- Live state ("GW 7 live · 3/10 played", ● playing, ✓ done) is worked out on the device from kickoff times, using the same 2-hour rule as the backend's match-window guard. The app refetches `/gameweek/current` a minute after each deadline and every 10 minutes otherwise.
- The suggested XI is picked on the device from the xP rows.

## CI and deploys

CI (`.github/workflows/ci.yml`) runs on every PR and push to `main`, in four jobs: CDK build + jest; pytest for each Lambda in its own virtualenv (so a missing requirement can't hide behind a shared environment); pytest for the layer; and mobile type-check, lint, Prettier and jest. The `backend/scripts` tests are not run in CI.

There is no CD. Backend deploys are a manual `npm run deploy` from a machine with AWS credentials and Docker. Amplify rebuilds the web app on its own from `main`. See the [operations runbook](operations.md).
