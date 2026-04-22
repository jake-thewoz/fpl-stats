# ingest_fpl

Scheduled Lambda that fetches the FPL API and caches a typed subset into
DynamoDB. Runs every 30 minutes via an EventBridge rule.

## Cached shape

Two items are written to the shared cache table after each successful run:

| `pk`             | `sk`     | `data`                                              |
| ---------------- | -------- | --------------------------------------------------- |
| `fpl#bootstrap`  | `latest` | `{ teams, positions, players, gameweeks }` (dicts)  |
| `fpl#fixtures`   | `latest` | array of fixture dicts                              |

Every item also carries:

- `schema_version` — integer version of the typed shape (see below)
- `fetched_at` — ISO-8601 UTC timestamp of the successful fetch

Both items are written as a single logical unit: if either FPL fetch
fails, nothing is written, and the previously good data stays put.

## Schema versioning

The pydantic models in
[`backend/layers/fpl_schemas/python/schemas.py`](../../layers/fpl_schemas/python/schemas.py)
are the authoritative definition of what's in the cache. The
module-level `SCHEMA_VERSION` constant is stamped on every stored item.
Readers should pin to the version they were built against and either
degrade gracefully or raise loudly on a mismatch.

The schemas ship as a Lambda layer (`FplSchemasLayer` in the stack) and
are attached to both the ingest Lambda and each read-path Lambda, so
there's a single source of truth. Local pytest finds them via a
`sys.path` insert in each lambda's `conftest.py`.

When to bump `SCHEMA_VERSION`:

- **Additive change** — new optional field: no bump. Old readers ignore
  the new field.
- **Breaking change** — rename, remove, or narrow a field: bump, and
  ship every reader at the same time. Ingestion overwrites the cache
  every 30 minutes, so there's no back-compat window to worry about.
- **FPL drift** — FPL adds or renames a field we parse: update the
  model; bump only if our stored shape changes breakingly.

