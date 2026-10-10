# AWS learning notes

One of this project's goals is learning AWS hands-on. This page collects the Solutions Architect angle on decisions made in the stack: why each piece is configured the way it is, and what the exam would ask about it. The [Field Guide](artifacts/README.md) has the same notes attached to each box on its architecture map, plus the drills below as a clickable quiz.

AWS behaviour described here is as of mid-2026. Check current docs before relying on a specific price or limit.

## By service

### Lambda

- **Memory is the CPU dial.** vCPU share scales linearly with memory, reaching one full vCPU at 1,769 MB. A function that times out with low Max Memory Used is CPU-starved; raise memory. For CPU-bound work, the shorter duration usually offsets the higher per-ms price. See [performance](performance.md).
- **15-minute hard ceiling.** If `ingest_player_history` ever outgrows it, the answer is fan-out (SQS feeding parallel workers, or a Step Functions Map state), not a longer timeout.
- **Async invocation retries.** EventBridge invokes Lambda asynchronously; Lambda retries a failed async invocation twice by default. Attach an on-failure destination or DLQ to catch what still fails.
- **Layers.** Up to 5 per function; function plus layers must fit in 250 MB unzipped. Layer versions are immutable: each deploy publishes a new version and repoints functions.
- **Concurrency is an account-wide pool.** New accounts can start at 10 concurrent executions shared by every function. Fan-out from a client (Friends tab) can throttle unrelated routes.
- **Cold starts** are mostly runtime start plus module imports. Provisioned concurrency and SnapStart remove them for a fee; caching in front of Lambda removes them for free.
- **No VPC on purpose.** Lambdas outside a VPC reach the internet directly. In a private subnet, FPL calls would need a NAT Gateway (about $32/month plus data), the most common way a hobby stack leaves the free tier. DynamoDB and S3 gateway endpoints are free.

### API Gateway (HTTP API)

- **HTTP API vs REST API.** HTTP is roughly 70% cheaper with lower latency and supports JWT authorizers natively. It lacks API keys and usage plans, request validation, response caching and direct WAF attachment. All of those are REST-only.
- **30-second integration timeout.** That's why the transfers Lambda's 30 s timeout is already the ceiling.
- **Stage throttling** (20 req/s, burst 40) is the guard on a public, unauthenticated API. API Gateway uses a token bucket; excess requests get `429` before any Lambda runs, so they cost nothing. The account default (10,000 req/s) is far higher, which is why a stage limit matters.
- CDK only exposes `throttle` on stages added with `addStage()`, so this stack sets it on `$default` through a `CfnStage` escape hatch.
- HTTP API doesn't compress responses. CloudFront would.

### DynamoDB

- **Single-table design** with string `pk` / `sk` and no GSIs works because every read knows its key up front.
- **400 KB item limit.** The raw bootstrap payload is far bigger, so it lives in S3 and only a parsed subset goes in the table.
- **`Decimal`, not `float`.** boto3 rejects Python floats on write and returns `Decimal` on read.
- **TTL is a background sweep** that can lag by days. Expired items can still be returned, so cache-aside handlers also check `expires_at` themselves. TTL deletes don't consume write capacity.
- **Scan** reads and bills every item it passes, 1 MB per page, so it must paginate. Fine at ~21k rows; at larger scale you'd Query by partition or add a GSI.
- **Free tier:** the always-free 25 RCU / 25 WCU applies to provisioned mode. On-demand at this traffic still costs cents a month.
- **Zero-padded sort keys** (`gw#007`) keep string ordering numeric.

### S3

- **Standard-IA** bills a 30-day minimum and a 128 KB minimum object size; since September 2024 lifecycle rules skip objects under 128 KB by default. Retrieval is milliseconds with a per-GB fee (hours-long retrieval is Glacier Flexible / Deep Archive).
- **`enforceSSL`** adds a bucket policy denying requests where `aws:SecureTransport` is false.
- **Lifecycle expiry at 90 days** means last season's raw snapshots are gone. Copy anything you need to a non-expiring prefix first (e.g. the ClubELO seed for #166).

### EventBridge

- Four rules drive all background work; cron is UTC.
- **EventBridge Scheduler** is the newer home for scheduled jobs: time zones, one-off schedules, flexible windows and per-target retry policy. A one-off schedule per FPL deadline is how precomputed xP (#181) would roll over at the deadline.
- The analyzers are **chained by clock**, not events. Step Functions (#40) would make the dependency explicit.

### CloudWatch and SNS

- **M-of-N alarms.** `evaluationPeriods: 2, datapointsToAlarm: 2` needs two consecutive bad windows, so one transient FPL 403 doesn't page you.
- **`NOT_BREACHING`** treats "no invocations" as OK, which also means a job that stops running entirely won't alarm.
- **Alarm actions fire on state changes.** An alarm stuck in ALARM emails once. Two alarms sat in ALARM for months during the 2026 off-season. Check states with `describe-alarms`.
- **Error alarms only see crashes.** A job that succeeds while writing stale data stays green; freshness needs its own check (or a custom metric).
- **SNS** is push fan-out: add SQS, Lambda or chat subscribers later without touching the alarms. Email subscriptions stay pending until confirmed.
- A health route is the natural target for a Route 53 health check or a CloudWatch Synthetics canary.

### CloudFormation and CDK

- `grantReadData` / `grantReadWriteData` generate a **least-privilege IAM policy per function**: read Lambdas get read-only access, only ingesters can `PutObject`.
- **`RemovalPolicy.DESTROY`** on the table and bucket means `cdk destroy` deletes the data. Fine for a rebuildable cache, wrong for anything you can't recreate.
- **Drift.** Amplify Hosting was set up in the console, so it's the one piece you can't recreate from code.
- A Lambda code change needs a deploy even with no resource diff: the asset hash changes.

### Amplify Hosting

Bundles CI/CD, a CloudFront CDN and hosting for static and SSR sites. Here it builds `mobile/` with `npx expo export -p web` on every push to `main`.

### CI/CD

Moving deploys into GitHub Actions would mean giving GitHub an AWS role. The recommended pattern is **OIDC federation** (GitHub's identity provider plus an IAM role it can assume), never long-lived access keys stored as secrets.

## Exam drills from this stack

Each question is a decision already made here, or one the stack will face. Answers follow each question.

**1. `analyze_transfer_suggestions` timed out at 15 s with 256 MB, yet Max Memory Used was low. Cheapest fix?**
(a) Raise the timeout to 15 minutes (b) Raise memory to 1024 MB (c) Add provisioned concurrency (d) Move it to a container image

> **(b).** Low memory use plus a timeout means CPU starvation. 1024 MB gave about 4× the CPU and it finished in 5–8 s. API Gateway would cut the request off at 30 s regardless of a longer timeout.

**2. To "harden" the stack you move every Lambda into private VPC subnets. What breaks?**
(a) Only CloudWatch logging (b) Nothing (c) FPL calls, which need a NAT Gateway, plus DynamoDB and S3 unless you add gateway endpoints (d) Only the API Gateway integration

> **(c).** A Lambda in a VPC has no internet route. NAT Gateway restores it at about $32/month; DynamoDB and S3 gateway endpoints are free and keep that traffic private.

**3. Why does the ingest alarm use `evaluationPeriods = 2` and `datapointsToAlarm = 2`?**
(a) To halve the CloudWatch bill (b) So one transient FPL 403 doesn't email you; two bad windows in a row do (c) Lambda emits metrics hourly (d) SNS needs two messages to confirm

> **(b).** An M-of-N alarm, added in PR #149 after transient 403s caused noisy alerts.

**4. Which can a REST API do that this HTTP API can't?**
(a) Lambda proxy integration (b) CORS preflight (c) JWT authorizers (d) API keys with usage plans, and response caching

> **(d).** HTTP API is cheaper and faster and supports JWT natively, but usage plans, API keys, caching and direct WAF attachment are REST-only.

**5. A cached `entry#123` item expired 31 minutes ago. A request arrives. What happens?**
(a) DynamoDB already deleted it (b) The handler sees `expires_at` in the past, refetches from FPL and writes back (c) `ConditionalCheckFailed` (d) API Gateway serves its own cached copy

> **(b).** TTL deletion can lag by days, so the handler checks expiry itself.

**6. S3 lifecycle moves snapshots to Standard-IA at 30 days. Which is true?**
(a) IA retrievals take hours (b) Objects under 128 KB aren't transitioned by default, and IA bills a 30-day minimum (c) Transitions need versioning off (d) IA objects lose SSE-S3

> **(b).**

**7. Two alarms sat in ALARM for months and you got one email each. Why?**
(a) SNS throttles repeats (b) Alarm actions fire on state transitions, not every period (c) The subscription expired (d) `NOT_BREACHING` silenced them

> **(b).** Check states with `describe-alarms`, or build a daily digest of anything not OK.

**8. With no password on the web app, a scraper hammers `/analytics/squad/{id}/transfers`. Stage throttling is 20 req/s, burst 40. What happens to the excess?**
(a) Queued (b) `429`, and the Lambda is never invoked (c) Lambda runs but responses are dropped (d) API Gateway raises the limit

> **(b).** Token bucket; rejected before the integration runs, so the 1024 MB Lambda costs nothing.
