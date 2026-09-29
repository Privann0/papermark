# JETT IR Agent (Papermark → Paperclip → CMO)

Deterministic collector run by the Paperclip **IR Agent** (`process` adapter).
Pulls new Papermark views, writes a factual report and hands it to the **CMO**
as one Paperclip issue per batch. No LLM, no scoring, no outreach.

```
Papermark GET /api/agent/ir/views ──► ir_agent.py ──► POST /api/companies/:id/issues
   (keyset cursor, viewId)           SQLite state         (assignee=CMO, idempotencyKey)
```

## Guarantees

| Concern | Mechanism |
|---|---|
| No lost / double-counted view | `(viewedAt, id)` keyset cursor; page rows + cursor committed in one SQLite transaction; `INSERT OR IGNORE` on `viewId`; server only serves views older than 2 min |
| No duplicate issue | Batch frozen before the call; `idempotencyKey = jett-ir-report:<sha256(viewIds)>` (Paperclip replays the original issue); `allowDuplicate: true` + batch key in title so Paperclip's 48 h same-title merge never folds two batches together |
| Crash / outage recovery | Pending batches are retried first on the next run with the same key |
| Concurrency | `flock` on `<state>/run.lock` (exit 5 if held) |
| No CMO wake by default | `IR_HANDOFF_STATUS=backlog` (Paperclip skips the assignment wake for backlog). `todo` wakes the CMO |
| Facts vs interpretation | Report has counts only; `View.verified` unused; anonymous views never attributed; no HOT/WARM |
| Secrets | Token read from env or a `chmod 600` file; never printed; HTTP errors report status only |
| PII in run logs | stdout (stored by Paperclip) has counts, batch keys and issue ids only — never emails |

## Configuration

| Variable | Default | |
|---|---|---|
| `IR_PAPERMARK_URL` | `https://room.jett.city` | https required |
| `IR_PAPERMARK_TOKEN` / `IR_PAPERMARK_TOKEN_FILE` | – | machine key; needs scope `apis.all`, `apis.read` or `analytics.read` |
| `IR_STATE_DIR` | `~/.local/state/jett-ir-agent` | `state.db` (0600) + `run.lock` |
| `IR_CMO_AGENT_ID` | – | required in live mode |
| `IR_HANDOFF_STATUS` | `backlog` | `backlog` or `todo` |
| `IR_EXCLUDE_EMAIL_DOMAINS` | – | e.g. `jett.city` |
| `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID` | – | injected by the process adapter (run JWT); not set by hand |

Exit codes: `0` ok · `2` config · `3` Papermark · `4` Paperclip (batch left pending) · `5` locked.

## Validation

```bash
cd ~/papermark-src
python3 -m unittest discover -s integrations/ir-agent -v
npx tsx --test lib/agent/ir-views.test.ts
```

Dry-run against production (needs the endpoint deployed; writes nothing, calls no Paperclip API):

```bash
IR_PAPERMARK_TOKEN_FILE=~/.config/jett-ir-agent/papermark.token \
IR_EXCLUDE_EMAIL_DOMAINS=jett.city \
python3 integrations/ir-agent/ir_agent.py --dry-run --show-report   # emails masked
```

## Activation (requires Privann's approval — not done)

1. Deploy the fork with `pages/api/agent/ir/views.ts`.
2. Store the key: `install -m 600 /dev/null ~/.config/jett-ir-agent/papermark.token`, then
   paste the key into it with an editor (not via a shell command that lands in history).
3. Set the IR Agent `adapterConfig` (UI or `PATCH /api/agents/a7a534d9-…`):

   ```json
   {
     "command": "/usr/bin/python3",
     "args": ["/home/privann/papermark-src/integrations/ir-agent/ir_agent.py"],
     "cwd": "/home/privann/papermark-src/integrations/ir-agent",
     "timeoutSec": 300,
     "env": {
       "IR_PAPERMARK_URL": "https://room.jett.city",
       "IR_PAPERMARK_TOKEN_FILE": "/home/privann/.config/jett-ir-agent/papermark.token",
       "IR_CMO_AGENT_ID": "174c6f3f-e5e2-41ac-b6a8-1e3f4080bd37",
       "IR_HANDOFF_STATUS": "backlog",
       "IR_EXCLUDE_EMAIL_DOMAINS": "jett.city"
     }
   }
   ```

   Alternative to the token file: a Paperclip company secret bound as
   `"IR_PAPERMARK_TOKEN": {"type": "secret_ref", "secretId": "…"}`.
4. One manual run: `invoke_agent_heartbeat` on the IR Agent, then check the run log
   and the backlog issue assigned to the CMO.
5. Scheduling (IR Agent heartbeat `enabled`/`intervalSec`) is a separate decision.
