# Interactive artifacts

Clickable HTML explainers built alongside the project. Each is a single self-contained file: open it in a browser (it loads Google Fonts, and works offline without them). The live copies on claude.ai may be newer than these snapshots.

| File | What it is | Live copy |
| --- | --- | --- |
| [`field-guide.html`](field-guide.html) | **FPL Stats Field Guide.** An interactive architecture map with animated data-flow scenarios (every 30 minutes, overnight analytics, open My Team, gameweek goes live, ask for transfers, something breaks, open Friends, Sunday cleanup, ship a change), a 24-hour schedule clock, the DynamoDB key table, which app tab calls which route, the xP formula, ten exam drills and a project status board. | [claude.ai](https://claude.ai/artifact/6ofJ5vUjDo75Xgfuw3ELX6) |
| [`latency-casebook.html`](latency-casebook.html) | **Latency Casebook: the 128 MB bottleneck.** How slow read Lambdas were diagnosed, a request-time replay, a memory-size slider modelling duration and cost, and the CloudFront / precompute options. | [claude.ai](https://claude.ai/artifact/4fxX7iw2qBhyRf7ZohJV1Y) |
| [`stacked-prs.html`](stacked-prs.html) | **Stacked PRs, step by step.** A commit-graph replay of #173 and #174: why the second PR missed `main`, how retargeting first would have gone, and how #175 recovered it. | [claude.ai](https://claude.ai/artifact/B9hSZzZwfStPaGpGJfRkqq) |

Snapshot date: 11 Oct 2026. The Field Guide is current as of #216 (16 Lambdas, 12 routes, read Lambdas at 1024 MB, the on-device query cache, `/fixtures/upcoming`, `/players/stats` and the 5-move transfer search). It was written while #215 and #216 were in review; issue #217 (FPL 403s on `entry`) is open. The Latency Casebook and stacked-PR replay describe past events and don't need updating. The markdown docs in [`docs/`](../README.md) are the reference; treat these as visual companions.

To open from WSL in the Windows browser:

```bash
explorer.exe "$(wslpath -w /home/jakob/dev/fpl-stats/docs/artifacts/field-guide.html)"
```
