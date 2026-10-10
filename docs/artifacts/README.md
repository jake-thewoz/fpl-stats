# Interactive artifacts

Clickable HTML explainers built alongside the project. Each is a single self-contained file: open it in a browser (it loads Google Fonts, and works offline without them). The live copies on claude.ai may be newer than these snapshots.

| File | What it is | Live copy |
| --- | --- | --- |
| [`field-guide.html`](field-guide.html) | **FPL Stats Field Guide.** An interactive architecture map with animated data-flow scenarios (every 30 minutes, overnight analytics, open My Team, gameweek goes live, ask for transfers, something breaks, ship a change), a 24-hour schedule clock, the DynamoDB key table, which app tab calls which route, the xP formula, eight exam drills and a project status board. | [claude.ai](https://claude.ai/artifact/6ofJ5vUjDo75Xgfuw3ELX6) |
| [`latency-casebook.html`](latency-casebook.html) | **Latency Casebook: the 128 MB bottleneck.** How slow read Lambdas were diagnosed, a request-time replay, a memory-size slider modelling duration and cost, and the CloudFront / precompute options. | [claude.ai](https://claude.ai/artifact/4fxX7iw2qBhyRf7ZohJV1Y) |
| [`stacked-prs.html`](stacked-prs.html) | **Stacked PRs, step by step.** A commit-graph replay of #173 and #174: why the second PR missed `main`, how retargeting first would have gone, and how #175 recovered it. | [claude.ai](https://claude.ai/artifact/B9hSZzZwfStPaGpGJfRkqq) |

Snapshot date: 10 Oct 2026. The Field Guide predates #183–#189, so it still shows read Lambdas at 128 MB and doesn't cover the on-device query cache, friend squad view or free-transfer overrides. The markdown docs in [`docs/`](../README.md) are current; treat these as visual companions.

To open from WSL in the Windows browser:

```bash
explorer.exe "$(wslpath -w /home/jakob/dev/fpl-stats/docs/artifacts/field-guide.html)"
```
