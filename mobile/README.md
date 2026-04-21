# FPL Stats — mobile (Expo)

React Native app via Expo managed workflow + TypeScript.

## Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local, set API_BASE_URL to the ApiBaseUrl from
# backend/.deploy-outputs.json
```

## Commands

- `npx expo start` — dev server; scan QR with Expo Go or run on a simulator
- `npx expo start --web` — run in a browser (useful for debugging fetches)
- `npx tsc --noEmit` — type-check

## Configuration

Runtime config comes from `app.config.ts`, which reads env vars at bundle
time and exposes them to the app via `expo-constants` (`Constants.expoConfig.extra`).

| Env var        | Purpose                                   | Default                  |
| -------------- | ----------------------------------------- | ------------------------ |
| `API_BASE_URL` | Base URL of the FPL Stats backend HTTP API | `http://localhost:3000` |

Env vars live in `.env.local` (gitignored). Restart `npx expo start` after
editing them — `app.config.ts` only resolves env at bundle startup.
