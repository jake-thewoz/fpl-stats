# FPL Stats

Fantasy Premier League companion app for personal/friends use. Secondary goal: hands-on AWS learning.

## Stack

- **Mobile:** React Native via Expo (managed workflow) + TypeScript
- **Backend:** AWS CDK (TypeScript) — Lambda + API Gateway + DynamoDB + EventBridge
- **Data flow:** A scheduled Lambda pulls the public FPL API (`https://fantasy.premierleague.com/api/`) and caches results into DynamoDB. The mobile app reads only from our API, never directly from FPL.

## Layout

```
fpl-stats/
├── mobile/       # Expo app
├── backend/      # CDK app — infra stacks + Lambda handler source
└── CLAUDE.md     # this file
```

A `shared/` package for cross-boundary types will be introduced the first time a type genuinely needs to be shared between mobile and backend — not before.

## Commands

### Mobile (`cd mobile`)
- `npm install` — first-time setup
- `npx expo start` — dev server; scan QR with the Expo Go app or run on a simulator
- `npx tsc --noEmit` — type-check

### Backend (`cd backend`)
- `npm install` — first-time setup
- `npm run build` — compile TS → JS
- `npm run test` — jest unit tests
- `npx cdk synth` — render CloudFormation without deploying
- `npx cdk diff` — diff deployed stack vs local
- `npx cdk deploy` — deploy (requires `cdk bootstrap` once per account/region)

## Conventions

### TypeScript
- `strict: true`. Prefer `unknown` + narrowing over `any`.
- Don't add type annotations a good IDE would infer; annotate at module boundaries.

### AWS
- Region: `us-east-1` (default for this account).
- Stay inside free-tier limits. Flag resource choices that would push past it (e.g. NAT gateways, provisioned-capacity DynamoDB).
- Prefer L2 CDK constructs. Avoid custom constructs until duplication makes the abstraction pull its weight.
- Handler code lives under `backend/lib/handlers/` and is bundled by `NodejsFunction` (esbuild) — no separate build step needed for Lambda sources.

### Git
- Default branch: `main`. Feature work on short-lived branches, merge via PR.
- Commit messages: descriptive first line (< 72 chars), body only when the "why" isn't obvious from the diff.

### Testing
- Backend: jest (scaffolded by CDK).
- Mobile: test setup TBD — will add when the first component justifies it.
