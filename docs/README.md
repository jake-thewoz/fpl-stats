# FPL Stats documentation

Start with the [project README](../README.md) for the overview and quick start.

| Doc | Covers |
| --- | --- |
| [Architecture](architecture.md) | Every AWS resource, Lambda, schedule, DynamoDB key shape and API route; the shared layer; how the app uses the API; CI and deploys. |
| [xP model](xp-model.md) | The expected-points model: components, availability, the data pipeline, fitting and backtesting, and how to make common changes. |
| [Operations runbook](operations.md) | Copy-pasteable commands for deploying, smoke tests, running jobs by hand, alarms, inspecting data; the season rollover checklist; dev gotchas; free-tier notes. |
| [Performance](performance.md) | The 128 MB bottleneck write-up, how to diagnose Lambda latency, and the open CloudFront / precompute options. |
| [AWS learning notes](aws-learning-notes.md) | Solutions Architect notes per service, drawn from this stack, plus eight exam drills. |
| [Project history](history.md) | Timeline, key decisions and their reasons, incidents, and a milestone snapshot. |
| [Friends onboarding](friends-onboarding.md) | The page to send a new user. |
| [Interactive artifacts](artifacts/README.md) | HTML explainers: Field Guide, Latency Casebook, stacked-PR replay. |

Documentation that lives next to its code:

- [`mobile/CLAUDE.md`](../mobile/CLAUDE.md): mobile conventions (design tokens, API client, query layer, hooks, dialogs).
- [`backend/README.md`](../backend/README.md): first-time AWS and CDK bootstrap.
- [`backend/scripts/README.md`](../backend/scripts/README.md): fitting and backtesting the xP model.
- [`backend/lambdas/ingest_fpl/README.md`](../backend/lambdas/ingest_fpl/README.md): the cached bootstrap and fixtures shape.
- [`CLAUDE.md`](../CLAUDE.md): commands and conventions for the whole repo.

When something changes, update the markdown here; the HTML artifacts are point-in-time snapshots.
