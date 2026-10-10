# FPL Stats

Fantasy Premier League companion app for personal/friends use, eventually public. Secondary goal: hands-on AWS learning.

## Stack

- **Mobile:** React Native via Expo (managed workflow) + TypeScript
- **Backend infra:** AWS CDK in TypeScript — API Gateway + DynamoDB + EventBridge + S3
- **Lambda handlers:** Python 3.12 (preferred language for all backend logic)
- **Data flow:** A scheduled Lambda pulls the public FPL API (`https://fantasy.premierleague.com/api/`) and caches results into DynamoDB and S3. The mobile app reads only from our API, never directly from FPL.

## Layout

```
fpl-stats/
├── mobile/              # Expo app (TypeScript)
├── backend/
│   ├── bin/             # CDK app entrypoint (TS)
│   ├── lib/             # CDK stacks + constructs (TS)
│   ├── lambdas/         # Python Lambda handlers, one dir per function
│   │   └── <name>/      # handler.py, requirements.txt, tests/
│   └── test/            # jest tests for CDK stacks
└── CLAUDE.md
```

A `shared/` package for cross-boundary types will be introduced the first time a type genuinely needs to be shared between mobile and backend — not before.

## Commands

### Mobile (`cd mobile`)
- `npm install` — first-time setup
- `npx expo start` — dev server; scan QR with the Expo Go app or run on a simulator
- `npx tsc --noEmit` — type-check
- `npm test` — jest unit tests (`jest-expo` preset), co-located as `*.test.ts`

### Backend infra (`cd backend`)
- `npm install` — first-time setup
- `npm run build` — compile CDK TS → JS
- `npm run test` — jest unit tests (for stacks). Skips `PythonFunction` bundling, so it needs no Docker and runs in ~30s rather than ~5min.
- `npx cdk synth` — render CloudFormation without deploying (bundles for real, so Docker is required)
- `npx cdk diff` — diff deployed stack vs local
- `npx cdk deploy` — deploy (requires `cdk bootstrap` once per account/region, and Docker running locally for `PythonFunction` bundling)

### Lambdas (`cd backend/lambdas/<name>`)
- `python -m venv .venv && source .venv/bin/activate` — first-time setup
- `pip install -r requirements.txt -r requirements-dev.txt`
- `pytest` — unit tests

## Working from a cloud sandbox (no AWS access)

Sessions started from claude.ai/code run in a sandbox holding **only this repo**. There are no AWS credentials, so `cdk deploy`, `cdk diff`, and anything reading the live DynamoDB tables or S3 buckets are out of reach. Failures there are the expected state, not a fault to debug.

What runs clean from a fresh clone, all verified: `backend` — `npm ci`, `npm run build`, `npm test`; each handler in `backend/lambdas/<name>` — venv, `pip install`, `pytest`; the shared layer in `backend/layers/fpl_schemas` — venv, `pip install -r requirements-dev.txt`, `pytest`; `mobile` — `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm test`.

What does not: `cdk synth` and `cdk deploy`, which bundle Lambdas through Docker. CI covers the rest on every PR, so push the branch and read the checks.

## Conventions

### Languages
- **CDK (TS):** `strict: true`. Prefer `unknown` + narrowing over `any`. Don't add type annotations a good IDE would infer; annotate at module boundaries.
- **Mobile (TS):** same rules as CDK.
- **Lambdas (Python):** 3.12. Type hints on function signatures and at module boundaries; not required on every local. Parse external API payloads through `pydantic` models rather than raw dicts.

### AWS
- Region: `us-east-1` (default for this account).
- Stay inside free-tier limits. Flag resource choices that would push past it (e.g. NAT gateways, provisioned-capacity DynamoDB).
- Prefer L2 CDK constructs. Avoid custom constructs until duplication makes the abstraction pull its weight.
- Lambda handlers are bundled by CDK `PythonFunction` (`aws-cdk-lib/aws-lambda-python-alpha`), Docker-based. Each Lambda owns its own `requirements.txt` for clean dependency boundaries.

### Git
- Default branch: `main`. Feature work on short-lived branches, merge via PR.
- Commit messages: descriptive first line (< 72 chars), body only when the "why" isn't obvious from the diff.

### Testing
- CDK infra (TS): jest.
- Lambda handlers and the shared `fpl_schemas` layer (Python): pytest.
- Mobile: jest via `jest-expo`, for pure logic (e.g. the lineup picker). No component/render tests yet.
- CI (`.github/workflows/ci.yml`) runs all of these on every PR and on pushes to `main`.
