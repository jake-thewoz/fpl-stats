# Performance

Why the app was slow in early October 2026, how the cause was found, what fixed it, and what's still open in the **Phase 3.7: Latency** milestone. The interactive version, with a request replay and a memory-size slider, is the [Latency Casebook](artifacts/README.md).

## Summary

Read Lambdas ran at 128 MB, which buys about 7% of one vCPU. Handlers that do ~0.3 s of real work took 2–5 s warm. PR #183 raised the project default to 1024 MB. Warm durations dropped about 8× and the bill stayed flat.

| Endpoint | Warm duration | Cold init | Time to first byte | GB-seconds per call |
| --- | --- | --- | --- | --- |
| `/gameweek/current` | 2,430 → **306 ms** | 745 → 698 ms | 2.50 → **0.39 s** | 0.30 → 0.31 |
| `/players` | 2,070 → **290 ms** | 684 → 607 ms | 2.15 → **0.35 s** | 0.26 → 0.29 |
| `/analytics/players/xp` | 5,390 → **700 ms** | 1,244 → 1,232 ms | 5.43 → **0.73 s** | 0.67 → 0.70 |

Measured 10 Oct 2026 from a home connection to `us-east-1`, plus CloudWatch `REPORT` lines.

## How it was tracked down

The method: split a request into pieces, time each piece on its own, and only work on the slow one.

**1. Time the request from outside.** `/health` runs a Lambda that does nothing, so it shows the fixed cost of DNS, TLS, API Gateway and invocation.

```bash
API_URL=$(jq -r '.FplStatsStack.ApiBaseUrl' /home/jakob/dev/fpl-stats/backend/.deploy-outputs.json)
curl -s -o /dev/null -w "health ttfb=%{time_starttransfer}\n" "$API_URL/health"
curl -s -o /dev/null -w "gameweek ttfb=%{time_starttransfer}\n" "$API_URL/gameweek/current"
```

Before the fix: 0.075 s for `/health`, 2.5 s for `/gameweek/current`. Network and API Gateway accounted for ~70 ms; everything else was inside our code.

**2. Read Lambda's own report.** Every invocation logs one `REPORT` line, the cheapest profiler AWS offers:

```
REPORT RequestId: … Duration: 2452.25 ms  Billed Duration: 2453 ms  Memory Size: 128 MB  Max Memory Used: 105 MB  Init Duration: 745.40 ms
```

| Field | Meaning |
| --- | --- |
| Duration | Wall-clock time inside the handler. |
| Billed Duration | What you pay for. Since August 2025 the init phase on cold starts is billed too. |
| Memory Size | Configured memory, which also sets CPU: one full vCPU at 1,769 MB. |
| Max Memory Used | Peak memory. 105 of 128 MB looks like a memory problem, but it was the CPU that comes with memory we were short of. |
| Init Duration | Cold starts only: starting the runtime and importing boto3 and pydantic. |

**3. Run the same work with a full CPU.** From a laptop against the real table: `get_item` on the ~500 KB bootstrap item 0.147 s (mostly WAN), deserialise 0.006 s, pydantic validate 0.003 s, 667-row xP query 0.178 s. About 0.35 s in total. The work was small, so the environment was the problem.

**4. Connect it to how Lambda allocates CPU.** Lambda has no CPU setting; CPU scales linearly with memory. Our handlers spend their time parsing JSON and building Python objects, which is CPU-bound, so at 7% of a core they ran roughly 14× slower than necessary. The xP analyzer and the transfers Lambda had hit the same wall earlier.

## Lessons

- **Size Lambdas by duration, not by memory used.** Max Memory Used is now ~120 of 1024 MB. That looks like over-provisioning, but the memory is there to buy CPU.
- **For CPU-bound work, more memory is nearly free.** Lambda bills memory × duration: 0.125 GB × 2.43 s ≈ 1 GB × 0.31 s ≈ 0.30 GB-s.
- **Past ~1,769 MB, single-threaded Python gains nothing.** Extra vCPUs sit idle and only the bill grows.
- **Memory doesn't fix cold starts.** Init stayed at 0.6–1.2 s; it's mostly runtime start and imports.
- **A timeout with low memory use means CPU starvation.** Raise `memorySize`, not `timeout`.

## Current state

Warm requests cost about 0.35 s and cold ones about 1.4 s. The heavier routes:

- `/analytics/players/xp` is ~0.7 s warm: a paginated 667-row query, each row turned into `Decimal`s.
- `/analytics/squad/{teamId}/transfers` takes several seconds because it does real computation (bundle search over hundreds of players). #189 added pruning inside each slot subset.
- My Team makes a chain of dependent requests (entry → picks → live), tracked as #180.
- Friends makes one `/entry` call per friend; a batch endpoint is #186.
- HTTP API never compresses responses, so `/players` goes out as ~257 KB.

On the client, TanStack Query's persisted cache (#184) means a reopened app shows its last data instantly while it refreshes, which hides most of the remaining latency.

## Options still open

| Option | Issue | What it does | Watch out for |
| --- | --- | --- | --- |
| CloudFront in front of the API | #179 | Handlers return `Cache-Control` (e.g. `s-maxage=300`); edge hits answer in tens of ms with no Lambda and no cold start. CloudFront also gzips (`/players` 257 KB → ~24 KB). Always-free tier covers 1 TB and 10M requests a month. | `/analytics/players/xp` drops locked gameweeks at read time, so long TTLs would serve a stale gameweek past a deadline. Keep TTLs to minutes or derive them from the next deadline. Per-team URLs cache separately. |
| Precompute responses to S3 | #181 | Ingest and analyzers write finished `players.json`, `xp.json`, `gameweek.json`; CloudFront serves them from a private bucket via Origin Access Control. No Lambda or DynamoDB on the read path. | Read-time logic moves to write time; the xP deadline rule would need an EventBridge Scheduler one-off at each deadline. Per-team data still needs a Lambda. |
| Reuse work across warm invocations | — | Parse the bootstrap into a module-level global keyed by `fetched_at`, skipping the 500 KB parse on most warm calls. | Memory per environment; invalidate on `fetched_at` change. |
| ARM64 (Graviton) | — | `architecture: Architecture.ARM_64`: ~20% cheaper per GB-s and often a little faster. | Docker bundling must build ARM wheels (pydantic-core). |

### Considered and rejected

- **Provisioned concurrency:** removes cold starts but bills for every hour environments sit ready, with no free tier. CloudFront removes most cold starts for free.
- **SnapStart for Python:** works, but snapshot caching and restores are billed.
- **Keep-warm pings:** warm only one environment per function, so two concurrent users still hit a cold start. Hides the problem rather than fixing it.
