# FPL Stats

A Fantasy Premier League companion app: your squad on a pitch with expected points (xP) for every player, a sortable player pool, ranked transfer suggestions that understand free transfers and hits, and a mini-league of friends. Built for personal and friends' use, and as a hands-on way to learn AWS.

**Live web app:** https://main.d29izwx9gn2m58.amplifyapp.com (installable as a PWA; this is the main client today)

## How it works

```
 FPL public API ──► scheduled Lambdas ──► DynamoDB (cache) + S3 (raw archive)
                    (EventBridge)              │
                    nightly analyzers ◄────────┤  xP + form
                                               ▼
 Expo app (web / iOS / Android) ──► API Gateway (HTTP API) ──► read Lambdas
```

- **Ingest:** every 30 minutes a Lambda pulls FPL's `bootstrap-static` and `fixtures` into one DynamoDB table and archives the raw JSON in S3. A weekly job pulls per-player match history.
- **Analyze:** nightly Lambdas compute rolling form and a nine-component xP model for the next five gameweeks.
- **Serve:** ten read-only `GET` routes on an API Gateway HTTP API. Per-team data (your squad, picks, live points, leagues) is fetched from FPL on demand and cached for 30 minutes. The app never calls FPL directly.
- **Client:** one React Native codebase (Expo + TypeScript), exported for web and hosted on Amplify.

Everything except the Amplify hosting is defined in a single CDK stack, `FplStatsStack`, in `us-east-1`.

## Repository layout

| Path | What's there |
| --- | --- |
| `mobile/` | Expo app (TypeScript). Conventions in [`mobile/CLAUDE.md`](mobile/CLAUDE.md). |
| `backend/lib/` | CDK stack (TypeScript). |
| `backend/lambdas/<name>/` | One Python 3.12 Lambda per directory: `handler.py`, `requirements.txt`, `tests/`. |
| `backend/layers/fpl_schemas/` | Shared Lambda layer: pydantic schemas, FPL session, deadline helpers, xP maths and fitted coefficients. |
| `backend/scripts/` | Offline, laptop-only tools for fitting and backtesting the xP model. Nothing here ships to AWS. |
| `docs/` | Project documentation. Start at [`docs/README.md`](docs/README.md). |
| `.github/workflows/ci.yml` | CI: CDK jest, pytest per Lambda and for the layer, mobile type-check/lint/format/jest. |
| `amplify.yml` | Amplify build spec for the web export. |

## Quick start

Prerequisites: Node 22, Python 3.12, and for deploys, the AWS CLI with credentials plus Docker (CDK bundles Python Lambdas in Docker).

```bash
# Mobile app against the deployed API
cd /home/jakob/dev/fpl-stats/mobile
npm install
cp .env.example .env.local   # set API_BASE_URL to the stack's ApiBaseUrl output
npx expo start               # press w for web, or scan the QR code with Expo Go

# Backend tests (no AWS or Docker needed)
cd /home/jakob/dev/fpl-stats/backend
npm install && npm run build && npm test

# One Lambda's tests
cd /home/jakob/dev/fpl-stats/backend/lambdas/players
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest

# Deploy (Docker must be running)
cd /home/jakob/dev/fpl-stats/backend
npm run deploy               # writes stack outputs to backend/.deploy-outputs.json
```

The full command reference is in [`CLAUDE.md`](CLAUDE.md); first-time AWS setup (CDK bootstrap) is in [`backend/README.md`](backend/README.md).

## Documentation

| Doc | Read it when |
| --- | --- |
| [Architecture](docs/architecture.md) | You want to know what each piece does: Lambdas, schedules, every DynamoDB key, every route, and which app tab calls what. |
| [xP model](docs/xp-model.md) | You're touching predictions, coefficients or the fit/backtest scripts. |
| [Operations runbook](docs/operations.md) | You're deploying, smoke-testing, chasing an alarm, or preparing for the next season. |
| [Performance](docs/performance.md) | The app feels slow, or you're sizing a Lambda. |
| [AWS learning notes](docs/aws-learning-notes.md) | You want the Solutions Architect angle on decisions made in this stack. |
| [Project history](docs/history.md) | You want the timeline, milestones and the reasoning behind past decisions. |
| [Friends onboarding](docs/friends-onboarding.md) | You're sending the app to someone new. |
| [Interactive artifacts](docs/artifacts/README.md) | You'd rather click around: the Field Guide, the Latency Casebook, and the stacked-PR replay. |

## Status

Usable and public (throttled API, no login). Work is tracked as GitHub milestones; the open ones are latency (CloudFront, precomputed responses), frontend polish, an Android store release, and a post-launch backlog. See [history](docs/history.md#where-things-stand) for a snapshot.
