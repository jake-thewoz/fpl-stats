# Project history

How FPL Stats got here, the decisions that shaped it, and where things stand. GitHub milestones (the "epics") remain the source of truth for open work; this page records the reasoning that issues and commits don't.

## Timeline

| Date | What happened |
| --- | --- |
| 21 Apr 2026 | First commit: Expo app + CDK backend scaffold. Python chosen for Lambdas the same day. |
| 21–23 Apr | Phase 0–2: walking skeleton, MVP (ingest, players, my team), log retention and SNS alarms (#70), friends comparison (#80). |
| 24–28 Apr | Phase 3 and 3.6: custom analytics and the transfer engine. xP v2 built as a pure compute layer (#120), opted into transfers (#125), v1 retired the same day (#127). Coefficients fitted and backtested on 28 Apr. |
| 30 Apr | Fringe players' xP dampened by season selection rate (#140). |
| 1 May | Web build and Amplify spec for a password-protected friends beta (#145). |
| 3 May | FPL 403 retries and 2-of-2 alarm debounce (#149). |
| 5 May | Mobile standardisation pass: design tokens, data plumbing, component restructure, lint/format (#151–#156). |
| May–Sep | Quiet. The 2026/27 season starts in August and silently breaks the cache (below). |
| 9 Oct | Back to it. CI added (#157); season rollover fixed (#158); API throttled (#163) and the web password removed, making the app public; layer tests in CI (#164); xP fit fix (#165); ClubELO dropped (#167). |
| 9–10 Oct | My Team pitch view (#168) and suggested lineup (#170); filter chips (#171); plan for the next deadline rather than the live gameweek (#173); live gameweek banner and player markers (#174, landed via #175). |
| 10 Oct | Latency work: read Lambdas to 1024 MB (#183); on-device query cache (#184); retries and web pull-to-refresh (#185); friend squad view (#187); free-transfer fixes and user overrides (#189). |

## Decisions and why

**Python for Lambdas, TypeScript everywhere else.** Python is the stronger language for the data and modelling work; CDK and the app stay in TypeScript. pydantic models parse every FPL payload instead of raw dicts.

**The app never calls FPL directly.** FPL blocks scripted traffic, and calling it from every device would multiply load on a public API we don't control. A server-side cache also means an FPL outage degrades to stale data instead of a broken app.

**One DynamoDB table, no GSIs.** Every access pattern is a known key. Single-table design kept the stack small and was a deliberate learning exercise.

**xP v2 replaced v1 outright (#127).** v2 sums nine position-aware components with coefficients fitted offline. There was no soak period for v1: with only friends as users, there was no one to protect. Revisit that habit if the app goes properly public.

**Coefficients are fitted on a laptop, not in AWS.** `backend/scripts/fit_xp_v2.py` reads the table, fits, and writes JSON into the layer. Keeps numpy/pandas-style dependencies out of Lambda bundles. See [xP model](xp-model.md).

**Defensive contributions ("defcon") are a first-class xP component.** New in 25/26 scoring, and decisive for budget midfielders and defenders. More defcon-adjacent stats are planned.

**FPL's `chance_of_playing = 100` is treated as "no information".** It covers ~60% of available players, including never-picked fringe players. Only values below 100 carry signal.

**ClubELO dropped (#167).** Their free API moved behind a login on 1 Sep 2026. Fixture quality now comes from FPL's difficulty rating alone. Building our own Elo from FPL results is #166; its seed data in S3 (`clubelo/ratings/`) expires around 29 Nov 2026 unless copied.

**Public without a login, guarded by throttling (#163).** The Amplify basic-auth password came off once the API was limited to 20 req/s. No custom domain yet, by choice (#162); the steps are recorded on that issue.

**"Upcoming" means the deadline hasn't passed (#173).** xP, the suggested XI and transfer plans used to target the live gameweek, which managers can no longer change. All "which gameweek?" logic now goes through deadline helpers in the layer, not FPL's `is_current` flag.

**1024 MB default for every Lambda (#183).** CPU scales with memory; at 128 MB handlers were 8× slower at the same cost. See [performance](performance.md).

**Free-transfer count is derived, but users can override it (#189).** The public FPL history doesn't show pending transfers, so the derived count can be wrong mid-week.

## Incidents and lessons

### The 2026/27 season rollover

FPL renumbers player and fixture ids every August. The writers only overwrote by key, so by October 90% of history rows were 2025/26 matches attached to ids that now belonged to different players. xP was wrong, the table grew until `analyze_player_xp_v2` timed out nightly, and xP had been stale since 3 September. The alarms had each emailed once when they tripped and then gone quiet.

Fixed in #158: every writer prunes rows its run didn't produce (`ddb_prune`), the xP analyzer got more memory, and promoted clubs were mapped. The lesson is in the [season rollover checklist](operations.md#season-rollover-checklist), and the habit is to check alarm *states*, not the inbox.

### Stacked PRs that missed `main`

Twice (#169, #174) a PR stacked on another merged into its parent's branch instead of `main`, because the repo doesn't auto-delete merged branches and so GitHub never retargeted the child. Both were re-landed (#170, #175). Avoid stacking; if you must, retarget the child before merging. The [stacked-PR replay](artifacts/README.md) walks through it commit by commit.

### The slow app

Read Lambdas at 128 MB took 2–5 s warm. Found with `curl -w` and Lambda `REPORT` lines; fixed with one CDK line. Full write-up in [performance](performance.md).

### Friends tab "feels broken"

Two causes: the account's Lambda concurrency limit was the new-account default of 10, and the Friends tab fires one request per friend; and `react-native-web`'s `RefreshControl` is a no-op, so pull-to-refresh did nothing on the web build. The quota was raised to 1000 and #185 added a web pull-to-refresh and retries. A batch endpoint is #186.

## Where things stand

Snapshot as of 10 Oct 2026. Check GitHub milestones for the live view.

| Milestone | Status |
| --- | --- |
| Phase 0: Walking skeleton | done |
| Phase 1: MVP | done |
| Phase 2: Social | done |
| Phase 3: Custom analytics | done |
| Phase 3.6: Transfer engine + friends launch | done |
| Phase 6: xP v2 | done |
| Phase 3.5: Frontend polish | 2 open: live-gameweek points view (#182), gameweek-aware app tracking issue (#172) |
| Phase 3.7: Latency | 4 open: CloudFront (#179), precompute to S3 (#181), My Team waterfall (#180), analysis (#176) |
| Phase 4: Distribution (Android) | not started: EAS build, Play Console, internal then closed testing (#41–#47) |
| Phase 5: Post-launch backlog | 12 open, including own Elo (#166), cached live endpoint (#150), weather and rotation features (#142, #143), Step Functions spike (#40) |

Not in a milestone: re-fit xP on 2026/27 data around GW10, mid-November (#159); batch `/entries` endpoint (#186); custom domain (#162).

Six finished milestones are still marked open on GitHub and could be closed.
