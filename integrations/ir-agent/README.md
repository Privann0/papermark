# JETT IR Agent (Papermark → Paperclip → CMO)

Deterministic collector run by the Paperclip **IR Agent** (`process` adapter).
Pulls new Papermark views, writes a factual report and hands it to the **CMO**
as one Paperclip issue per batch. No LLM, no scoring, no outreach.

```
Papermark GET /api/agent/ir/views ──► ir_agent.py ──► POST /api/companies/:id/issues
   (keyset cursor, viewId, since)    SQLite state         (assignee=CMO, idempotencyKey)
```

## Guarantees

| Concern | Mechanism |
|---|---|
| No lost / double-counted view | `(viewedAt, id)` keyset cursor; page rows + cursor committed in one SQLite transaction; `INSERT OR IGNORE` on `viewId` |
| Late inserts | `View.viewedAt` defaults to `CURRENT_TIMESTAMP` (transaction **start**), so a slow transaction can commit behind the cursor. Two layers: (1) the server only serves views older than 2 min; (2) every run re-reads `[latest collected view − IR_OVERLAP_HOURS, now]` without moving the cursor and reports anything new. Limit: a commit later than the overlap (24 h default) is missed |
| Operational start | `IR_SYNC_START` is required until the first live run records it in state; afterwards it can be omitted but not changed. Nothing before it ever becomes a ticket |
| No duplicate issue | Batch frozen before the call; `idempotencyKey = jett-ir-report:<sha256(viewIds)>` (Paperclip replays the original issue); `allowDuplicate: true` + batch key in title so Paperclip's 48 h same-title merge never folds two batches together |
| Crash / outage recovery | Pending batches are retried first on the next run with the same key |
| Concurrency | `flock` on `<state>/run.lock` (exit 5 if held) |
| No CMO wake by default | `IR_HANDOFF_STATUS=backlog` (Paperclip skips the assignment wake for backlog). `todo` wakes the CMO |
| Facts vs interpretation | Report has counts only; `View.verified` unused; anonymous views never attributed; no HOT/WARM |
| Secrets | Token read from env or a `chmod 600` file; never printed; HTTP errors report status only |
| PII in run logs | stdout (stored by Paperclip) has counts, batch keys and issue ids only — never emails |

## Endpoint contract — `GET /api/agent/ir/views`

- `Authorization: Bearer <machine key>`; 401 if unknown or expired, 403 unless scope is
  `apis.all`, `apis.read` or `analytics.read` (null = legacy `apis.all`).
- Scoped to the key's team via `Link.teamId`.
- `limit`: integer 1–500 (default 100; anything else falls back to 100, above 500 is clamped).
- `cursor`: opaque, from `nextCursor`; malformed → 400. `since`: ISO 8601 **with timezone**,
  inclusive; malformed or naive → 400.
- Order `(viewedAt, id)` ascending; `take limit+1` to compute `hasMore`; only views with
  `viewedAt ≤ now − 2 min`.
- Fields: `viewId, viewedAt, downloadedAt, viewType, archived, viewer{kind, email?},
  link, document, dataroom`. Never `verified`, viewer name, IP, geo or user agent.

## Configuration

| Variable | Default | |
|---|---|---|
| `IR_PAPERMARK_URL` | `https://room.jett.city` | https required |
| `IR_PAPERMARK_TOKEN` / `IR_PAPERMARK_TOKEN_FILE` | – | machine key |
| `IR_SYNC_START` | – | e.g. `2026-09-29T00:00:00+02:00`; timezone mandatory |
| `IR_OVERLAP_HOURS` | `24` | 0–720 |
| `IR_STATE_DIR` | `~/.local/state/jett-ir-agent` | `state.db` (0600) + `run.lock` |
| `IR_CMO_AGENT_ID` | – | required in live mode |
| `IR_HANDOFF_STATUS` | `backlog` | `backlog` or `todo` |
| `IR_EXCLUDE_EMAIL_DOMAINS` | – | e.g. `jett.city` |
| `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID` | – | injected by the process adapter (run JWT); not set by hand |

Modes: live (default) · `--dry-run [--show-report]` (read-only, emails masked) ·
`--historical-report FILE.md [--until ISO]` (views before `IR_SYNC_START`, new 0600 file,
no ticket, no state).

Exit codes: `0` ok · `2` config · `3` Papermark · `4` Paperclip (batch left pending) · `5` locked.

## Validation

```bash
cd ~/papermark-src
python3 -m unittest discover -s integrations/ir-agent -v
npx tsx --test lib/agent/ir-views.test.ts
```

## Key storage

```bash
integrations/ir-agent/store-token.sh    # hidden prompt → ~/.config/jett-ir-agent/papermark.token (0600)
```

Alternative: a Paperclip company secret bound as
`"IR_PAPERMARK_TOKEN": {"type": "secret_ref", "secretId": "…"}`.

Deployment, dry-run and activation: see [DEPLOY.md](DEPLOY.md).
