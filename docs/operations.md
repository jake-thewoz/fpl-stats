# Operations runbook

Deploying, checking that things work, investigating alarms, and the yearly season rollover. Every command block is copy-pasteable; the setup block at the top defines what the others use.

## Setup for any session

Requires AWS CLI credentials for the account, `jq`, and at least one prior deploy (for `backend/.deploy-outputs.json`).

```bash
export AWS_REGION=us-east-1
API_URL=$(jq -r '.FplStatsStack.ApiBaseUrl' /home/jakob/dev/fpl-stats/backend/.deploy-outputs.json)
TABLE=$(jq -r '.FplStatsStack.CacheTableName' /home/jakob/dev/fpl-stats/backend/.deploy-outputs.json)
BUCKET=$(jq -r '.FplStatsStack.SnapshotsBucketName' /home/jakob/dev/fpl-stats/backend/.deploy-outputs.json)

# Physical name of a Lambda from its CDK construct id, e.g. lambda_name AnalyzePlayerXpV2
lambda_name() {
  aws cloudformation list-stack-resources --stack-name FplStatsStack \
    --query "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function'].[LogicalResourceId,PhysicalResourceId]" \
    --output text | awk -v id="$1" '$1 ~ "^" id "[0-9A-F]{8}$" { print $2 }'
}
echo "$API_URL"; lambda_name IngestFpl
```

Prints the API base URL and the ingest function's name. If `.deploy-outputs.json` is missing, run a deploy first (below).

Construct ids for `lambda_name`: `Health`, `IngestFpl`, `IngestPlayerHistory`, `GameweekCurrent`, `Players`, `Entry`, `EntryGameweek`, `GameweekLive`, `LeagueMembers`, `AnalyzePlayerForm`, `AnalyzePlayerXpV2`, `AnalyticsPlayerForm`, `AnalyticsPlayersXp`, `AnalyzeTransferSuggestions`.

## Deploying

**When a deploy is required:** any change under `backend/lib/`, `backend/lambdas/`, or `backend/layers/`. A Lambda or layer code change needs a deploy **even when `cdk diff` shows no resource changes**: `PythonFunction` rebundles the code and pushes a new asset hash, which is how the new code reaches AWS.

**When it isn't:** changes only under `mobile/` (Amplify builds the web app from the repo), `docs/`, or `backend/scripts/`.

```bash
docker info > /dev/null && echo "Docker OK"
cd /home/jakob/dev/fpl-stats/backend
npm ci
npx cdk diff
npm run deploy
```

`cdk diff` lists resource changes (often none for code-only changes). `npm run deploy` takes 2–5 minutes, may ask you to confirm IAM changes, and rewrites `.deploy-outputs.json`. Success ends with `✅  FplStatsStack` and the outputs.

First-time account setup (`cdk bootstrap`) is in [`backend/README.md`](../backend/README.md).

## Smoke tests

Run the setup block first.

```bash
curl -s "$API_URL/health"; echo
curl -s "$API_URL/gameweek/current" | jq -c '{gw: .gameweek.id, next: .next_gameweek.id, fixtures: (.fixtures | length)}'
curl -s "$API_URL/players" | jq -c '{players: (.players | length)}'
curl -s "$API_URL/analytics/players/xp" | jq -c '{gameweek, computed_at, players: (.players | length)}'
```

Expect `{"ok": true, ...}`; the current and next gameweek with about 10 fixtures; roughly 650–750 players; and xP for the **next open** gameweek (one past the current one once its deadline has passed) with a `computed_at` from the last 04:30 UTC run, or later if someone invoked it by hand. A `computed_at` more than a day old means the analyzer is failing or skipping.

Timing a route (useful after a deploy, see [performance](performance.md)):

```bash
for i in 1 2 3; do curl -s -o /dev/null -w "ttfb=%{time_starttransfer}s\n" "$API_URL/gameweek/current"; done
```

The first call may be a cold start (about 1–1.5 s); warm calls should be well under half a second.

## Running a scheduled job by hand

Sync invokes wait for the result. The AWS CLI gives up after 60 s by default while the Lambda keeps running, so always pass `--cli-read-timeout`:

```bash
aws lambda invoke --function-name "$(lambda_name AnalyzePlayerXpV2)" \
  --cli-read-timeout 600 /tmp/xp-out.json && cat /tmp/xp-out.json; echo
```

Prints the handler's summary JSON. If you see `Read timeout on endpoint URL ... /invocations`, the job is **still running** server-side; check the logs before invoking again, or you'll have two runs hitting FPL at once.

For fire-and-forget (e.g. the five-minute history ingest), invoke asynchronously and watch the logs:

```bash
aws lambda invoke --function-name "$(lambda_name IngestPlayerHistory)" \
  --invocation-type Event /tmp/history-out.json
aws logs tail "/aws/lambda/$(lambda_name IngestPlayerHistory)" --since 10m --follow --format short
```

Returns `StatusCode: 202` immediately; the log tail shows progress. Ctrl-C to stop following.

`analyze_player_xp_v2` and `analyze_player_form` skip their run if a match kicked off in the last two hours. A run that "does nothing" during a match window is working as intended.

## Alarms

Five CloudWatch alarms on the Lambda `Errors` metric publish to SNS, which emails once **when an alarm enters ALARM**. It then stays quiet until it recovers. After any time away, check states rather than trusting a quiet inbox:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix FplStatsStack \
  --query "MetricAlarms[].[StateValue,AlarmName]" --output text
```

All five should read `OK`.

| Alarm | Trips when |
| --- | --- |
| `IngestFplErrorsAlarm` | ≥ 1 error in each of 2 consecutive 30-min windows |
| `IngestPlayerHistoryErrorsAlarm` | 1 error in a 7-day window |
| `AnalyzePlayerFormErrorsAlarm` | ≥ 1 error on 2 consecutive days |
| `AnalyzePlayerXpV2ErrorsAlarm` | ≥ 1 error on 2 consecutive days |
| `AnalyzeTransferSuggestionsErrorsAlarm` | ≥ 5 errors in 30 min |

Missing data counts as OK, so a job that stops being invoked entirely won't alarm. These alarms also only see crashes: a job that succeeds while writing stale data stays green, so the `computed_at` smoke test above is the real freshness check.

### Investigating

```bash
aws logs tail "/aws/lambda/$(lambda_name AnalyzePlayerXpV2)" --since 24h --format short | grep -E "ERROR|Task timed out|REPORT" | tail -20
```

Shows recent errors, timeouts and the `REPORT` line for each invocation (duration, memory size, max memory used).

Common causes, roughly in order of how often they've happened:

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `403` from FPL | FPL blocking scripted traffic. Usually transient. | `make_fpl_session()` already retries; one bad window is ignored by the 2-of-2 alarms. Persistent 403s mean the User-Agent needs refreshing. |
| `Task timed out` with low Max Memory Used | CPU starvation: Lambda CPU scales with memory | Raise `memorySize`, not `timeout`. See [performance](performance.md). |
| Analyzer timing out after a season change | Stale rows inflating scans | Check the history row count (below) and that pruning ran. |
| Intermittent "couldn't load" in the app, several tabs at once | Lambda throttling at the account concurrency limit | Check `Throttles` in CloudWatch and the concurrency quota (below). |
| Read Lambda 5xx right after a deploy | Response or cached shape changed | Check `SCHEMA_VERSION` and, on the client, `PERSISTED_CACHE_VERSION`. |

### Concurrency quota

New accounts start with a concurrent-execution limit of 10 shared by every function. The Friends tab fans out one `/entry` call per friend, so a limit that low throttles everything. It was raised to 1000 on 10 Oct 2026; check the current value:

```bash
aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 \
  --query "Quota.Value"
```

## Looking at the data

```bash
# Freshness of the bootstrap cache
aws dynamodb get-item --table-name "$TABLE" \
  --key '{"pk":{"S":"fpl#bootstrap"},"sk":{"S":"latest"}}' \
  --projection-expression "fetched_at, schema_version" --output json | jq -c '.Item'

# Number of xP rows (one per current player)
aws dynamodb query --table-name "$TABLE" --select COUNT \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"analytics#player_xp_v2"}}' --query Count

# Newest raw snapshots in S3
aws s3 ls "s3://$BUCKET/fpl/bootstrap-static/" | tail -3
```

`fetched_at` should be under 30 minutes old. The xP count should be close to the player count from the smoke test. The S3 listing should show a file from the last half hour.

History row count is a full-table scan; it reads every item, so run it only when investigating:

```bash
aws dynamodb scan --table-name "$TABLE" --select COUNT \
  --filter-expression "begins_with(pk, :p)" \
  --expression-attribute-values '{":p":{"S":"fpl#player_history#"}}' --query Count
```

Expect a few thousand rows early in the season, growing to roughly 25k by May. Much more than that early in a season means last season's rows weren't pruned.

## Season rollover checklist

FPL renumbers **player ids and fixture ids** every August. In 2026 this went unnoticed for two months: 90% of history rows ended up attached to the wrong players, xP went stale from 3 September, and the alarms had emailed once and then gone quiet (fixed in #158). Writers now prune what they didn't produce, but some steps still need a human. Nothing fails loudly to remind you, so use this list.

**Before the season ends (by late May):**

- [ ] Note which clubs are relegated and promoted.
- [ ] Re-read [the xP model's re-fit section](xp-model.md#re-fit-coefficients-from-production-history) and decide whether a pre-season fit is planned.

**When FPL opens the new season (usually July):**

- [ ] Add promoted clubs to `mobile/src/components/clubVisuals.ts` (keyed by `short_name`).
- [ ] If our own Elo ratings (#166) have shipped, add promoted clubs to its mapping too.
- [ ] Check FPL scoring rule changes (e.g. 25/26 added defensive contributions; 26/27 changed bonus scoring) and update the xP components if needed.
- [ ] Check free-transfer rules in `analyze_transfer_suggestions` still match FPL's.

**After the first post-rollover runs:**

- [ ] All alarms `OK` (command above), not just a quiet inbox.
- [ ] History row count is small (a few thousand), not tens of thousands.
- [ ] `/analytics/players/xp` `computed_at` is from last night and names the right gameweek.
- [ ] Spot-check a well-known player's xP (Haaland, Bruno Fernandes) against intuition.

**Re-fit coefficients** around GW10 once enough of the new season exists; a fit on only GW1–5 validated worse than last season's weights in 2026.

## Development gotchas

| Gotcha | What to do |
| --- | --- |
| jest asserts something that `cdk synth` disagrees with | Stale compiled `*.js` / `*.d.ts` in `backend/lib/`, `bin/` or `test/` from an old `npm run build`. `backend/jest.config.js` now prefers `.ts`, but if it recurs: `rm -f /home/jakob/dev/fpl-stats/backend/{lib,bin,test}/*.{js,d.ts}`. |
| `gh pr edit` fails with "Projects (classic) is being deprecated" | Use the REST API instead, e.g. `gh api -X PATCH repos/jake-thewoz/fpl-stats/pulls/<N> -f base=main`. |
| A stacked PR merged but its changes aren't on `main` | It merged into its parent branch. Happened twice (#169, #174). Avoid stacking; if you must, retarget the child to `main` before merging it. Walkthrough: [stacked-PR replay](artifacts/README.md). |
| Metro keeps serving old code after a branch switch | Restart with `npx expo start --web --clear`. |
| `python` not found | Use `python3` / `pip3`. |
| boto3 returns `Decimal`, not `float` | Convert before arithmetic or JSON serialisation; tests should use `Decimal` fixtures like production. |
| A pull-to-refresh fix works in Expo Go but not on web | `react-native-web`'s `RefreshControl` is a no-op; the web build uses `PullToRefresh.web.tsx`. Test UI changes on the web build, since that's the main client. |

## Cost and free tier

The stack is designed to sit inside the free tier at friends-and-family traffic: no VPC (so no NAT Gateway), no provisioned concurrency, HTTP API rather than REST API, S3 lifecycle expiry at 90 days, one-week log retention. DynamoDB is on-demand; at this traffic it costs cents a month. Note that DynamoDB's always-free 25 RCU / 25 WCU applies to **provisioned** mode, not on-demand.

Things that would push past free tier, so flag them before adding: NAT Gateways, provisioned concurrency, SnapStart, provisioned-capacity DynamoDB above 25 units, Lambdas above ~1,769 MB (single-threaded Python gains nothing past one vCPU), and a custom domain (Route 53 registration is not free).
