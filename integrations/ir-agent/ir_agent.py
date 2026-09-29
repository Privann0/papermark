#!/usr/bin/env python3
"""JETT IR Agent: Papermark views -> factual report -> Paperclip issue for the CMO.

Designed to run under Paperclip's `process` adapter (one run per heartbeat), but
also runnable by hand for dry-runs. Python stdlib only.

Guarantees
- Collection: keyset-paginated pull from /api/agent/ir/views. Each page's rows
  and the new cursor are committed in one SQLite transaction, so an interruption
  never loses or double-counts a view (INSERT OR IGNORE on viewId).
- Handoff: pending views are frozen into a batch (deterministic key = hash of
  its viewIds) *before* calling Paperclip. The issue is created with
  idempotencyKey=jett-ir-report:<key>, so a retry after a crash or timeout
  replays the original issue instead of creating a duplicate.
- Facts only: counts and who/what/when. No lead scoring, no outreach. Anonymous
  views are counted separately and never attributed to a person. View.verified
  is not used.
- Secrets never reach stdout/stderr (which Paperclip stores as run logs), and
  viewer emails are never printed either.

Exit codes: 0 ok, 2 config error, 3 Papermark error, 4 Paperclip error, 5 locked.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPORT_MARKER = "jett-ir-report"
MAX_PAGES_PER_RUN = 50
PAGE_LIMIT = 200
MAX_VIEWERS_IN_REPORT = 100
HTTP_TIMEOUT = 30
RETRIES = 3

EXIT_OK, EXIT_CONFIG, EXIT_PAPERMARK, EXIT_PAPERCLIP, EXIT_LOCKED = 0, 2, 3, 4, 5


class ConfigError(Exception):
    pass


class PapermarkError(Exception):
    pass


class PaperclipError(Exception):
    pass


# ── config ────────────────────────────────────────────────────────────────────


@dataclass
class Config:
    papermark_url: str
    papermark_token: str = field(repr=False)
    state_dir: Path
    cmo_agent_id: str
    handoff_status: str
    exclude_domains: tuple[str, ...]
    paperclip_url: str | None
    paperclip_key: str | None = field(repr=False)
    company_id: str | None
    run_id: str | None


def _read_secret(env: dict[str, str], name: str) -> str:
    """Secret from $NAME (e.g. Paperclip secret_ref) or from the file at $NAME_FILE."""
    value = env.get(name, "").strip()
    if value:
        return value
    path = env.get(f"{name}_FILE", "").strip()
    if not path:
        raise ConfigError(f"{name} or {name}_FILE must be set")
    p = Path(path).expanduser()
    try:
        mode = p.stat().st_mode & 0o077
    except FileNotFoundError:
        raise ConfigError(f"{name}_FILE does not exist") from None
    if mode:
        raise ConfigError(f"{name}_FILE must not be group/world readable (chmod 600)")
    value = p.read_text(encoding="utf-8").strip()
    if not value:
        raise ConfigError(f"{name}_FILE is empty")
    return value


def load_config(env: dict[str, str], need_paperclip: bool) -> Config:
    papermark_url = env.get("IR_PAPERMARK_URL", "https://room.jett.city").rstrip("/")
    if not papermark_url.startswith("https://") and not env.get("IR_ALLOW_HTTP"):
        raise ConfigError("IR_PAPERMARK_URL must be https")
    handoff_status = env.get("IR_HANDOFF_STATUS", "backlog")
    if handoff_status not in ("backlog", "todo"):
        raise ConfigError("IR_HANDOFF_STATUS must be backlog or todo")
    cfg = Config(
        papermark_url=papermark_url,
        papermark_token=_read_secret(env, "IR_PAPERMARK_TOKEN"),
        state_dir=Path(
            env.get("IR_STATE_DIR", "~/.local/state/jett-ir-agent")
        ).expanduser(),
        cmo_agent_id=env.get("IR_CMO_AGENT_ID", ""),
        handoff_status=handoff_status,
        exclude_domains=tuple(
            d.strip().lower().lstrip("@")
            for d in env.get("IR_EXCLUDE_EMAIL_DOMAINS", "").split(",")
            if d.strip()
        ),
        paperclip_url=(env.get("PAPERCLIP_API_URL") or "").rstrip("/") or None,
        paperclip_key=env.get("PAPERCLIP_API_KEY") or None,
        company_id=env.get("PAPERCLIP_COMPANY_ID") or None,
        run_id=env.get("PAPERCLIP_RUN_ID") or None,
    )
    if need_paperclip:
        missing = [
            n
            for n, v in (
                ("PAPERCLIP_API_URL", cfg.paperclip_url),
                ("PAPERCLIP_API_KEY", cfg.paperclip_key),
                ("PAPERCLIP_COMPANY_ID", cfg.company_id),
                ("IR_CMO_AGENT_ID", cfg.cmo_agent_id),
            )
            if not v
        ]
        if missing:
            raise ConfigError("missing: " + ", ".join(missing))
    return cfg


# ── http ──────────────────────────────────────────────────────────────────────


def http_json(method: str, url: str, headers: dict[str, str], body=None, *, err=Exception):
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Accept": "application/json", "User-Agent": "jett-ir-agent/1", **headers}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    last: str = ""
    for attempt in range(RETRIES):
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            # Only the status is reported: bodies may echo request data.
            last = f"HTTP {e.code}"
            e.close()
            if e.code != 429 and e.code < 500:
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = f"network error ({type(e).__name__})"
        time.sleep(min(2**attempt, 8))
    path = urllib.parse.urlsplit(url).path
    raise err(f"{method} {path}: {last}")


# ── state ─────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS views (
  view_id TEXT PRIMARY KEY,
  viewed_at TEXT NOT NULL,
  view_type TEXT NOT NULL,
  viewer_kind TEXT NOT NULL,
  viewer_email TEXT,
  link_id TEXT, link_name TEXT,
  document_id TEXT, document_name TEXT,
  dataroom_id TEXT, dataroom_name TEXT,
  downloaded_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT,
  batch_key TEXT,
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS views_unbatched ON views(batch_key) WHERE batch_key IS NULL;
CREATE TABLE IF NOT EXISTS batches (
  batch_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','sent')),
  view_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  issue_id TEXT, issue_identifier TEXT, sent_at TEXT
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def open_state(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(path, isolation_level=None)
    os.chmod(path, 0o600)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript(SCHEMA)
    return db


@contextlib.contextmanager
def tx(db: sqlite3.Connection):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")


@contextlib.contextmanager
def run_lock(state_dir: Path):
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(state_dir / "run.lock", "w") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("another IR Agent run holds the lock") from None
        yield


def get_meta(db, key):
    row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


# ── collection (facts) ────────────────────────────────────────────────────────


def skip_reason_for(view: dict, exclude_domains: tuple[str, ...]) -> str | None:
    if view.get("archived"):
        return "archived"
    email = (view.get("viewer") or {}).get("email")
    if email and exclude_domains:
        domain = email.rsplit("@", 1)[-1].lower()
        if domain in exclude_domains:
            return "internal_domain"
    return None


def store_page(db, views: list[dict], next_cursor: str | None, cfg: Config) -> int:
    inserted = 0
    collected = now_iso()
    with tx(db):
        for v in views:
            viewer = v.get("viewer") or {}
            kind = viewer.get("kind")
            if kind not in ("anonymous", "declared_email"):
                raise PapermarkError(f"unexpected viewer kind for view {v.get('viewId')}")
            doc, room, link = v.get("document") or {}, v.get("dataroom") or {}, v.get("link") or {}
            cur = db.execute(
                """INSERT OR IGNORE INTO views (view_id, viewed_at, view_type, viewer_kind,
                   viewer_email, link_id, link_name, document_id, document_name, dataroom_id,
                   dataroom_name, downloaded_at, archived, skip_reason, collected_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    v["viewId"], v["viewedAt"], v.get("viewType") or "",
                    kind, viewer.get("email") if kind == "declared_email" else None,
                    link.get("id"), link.get("name"), doc.get("id"), doc.get("name"),
                    room.get("id"), room.get("name"), v.get("downloadedAt"),
                    1 if v.get("archived") else 0,
                    skip_reason_for(v, cfg.exclude_domains), collected,
                ),
            )
            inserted += cur.rowcount
        if next_cursor:
            db.execute(
                "INSERT INTO meta(key,value) VALUES('cursor',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (next_cursor,),
            )
    return inserted


def fetch_page(cfg: Config, cursor: str | None) -> dict:
    q = {"limit": str(PAGE_LIMIT)}
    if cursor:
        q["cursor"] = cursor
    url = f"{cfg.papermark_url}/api/agent/ir/views?{urllib.parse.urlencode(q)}"
    data = http_json(
        "GET", url, {"Authorization": f"Bearer {cfg.papermark_token}"}, err=PapermarkError
    )
    if not isinstance(data, dict) or not isinstance(data.get("views"), list):
        raise PapermarkError("unexpected response shape from /api/agent/ir/views")
    return data


def collect(db, cfg: Config, *, persist: bool) -> dict:
    """Pull every settled view after the stored cursor. Returns stats and, when
    persist=False, the fetched views (for dry-runs)."""
    cursor = get_meta(db, "cursor")
    pages = fetched = inserted = 0
    buffered: list[dict] = []
    has_more = True
    while has_more and pages < MAX_PAGES_PER_RUN:
        page = fetch_page(cfg, cursor)
        pages += 1
        fetched += len(page["views"])
        if persist:
            inserted += store_page(db, page["views"], page.get("nextCursor"), cfg)
        else:
            buffered.extend(page["views"])
        cursor = page.get("nextCursor") or cursor
        has_more = bool(page.get("hasMore"))
    return {
        "pages": pages,
        "fetched": fetched,
        "inserted": inserted,
        "complete": not has_more,
        "buffered": buffered,
    }


# ── report (facts only, no interpretation) ────────────────────────────────────


def _rows_from_api(views: list[dict], cfg: Config) -> list[dict]:
    rows = []
    for v in views:
        viewer = v.get("viewer") or {}
        doc, room, link = v.get("document") or {}, v.get("dataroom") or {}, v.get("link") or {}
        rows.append(
            {
                "view_id": v["viewId"], "viewed_at": v["viewedAt"],
                "view_type": v.get("viewType") or "",
                "viewer_kind": viewer.get("kind"), "viewer_email": viewer.get("email"),
                "link_name": link.get("name"), "document_name": doc.get("name"),
                "dataroom_name": room.get("name"), "downloaded_at": v.get("downloadedAt"),
                "skip_reason": skip_reason_for(v, cfg.exclude_domains),
            }
        )
    return rows


def batch_key_for(view_ids: list[str]) -> str:
    return hashlib.sha256("\n".join(sorted(view_ids)).encode()).hexdigest()[:32]


def _asset(r) -> str:
    if r["dataroom_name"] and r["document_name"]:
        return f'{r["dataroom_name"]} › {r["document_name"]}'
    return r["dataroom_name"] or r["document_name"] or r["link_name"] or "(inconnu)"


def _md(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def build_report(rows: list, batch_key: str) -> dict:
    rows = sorted(rows, key=lambda r: (r["viewed_at"], r["view_id"]))
    identified = [r for r in rows if r["viewer_kind"] == "declared_email"]
    anonymous = [r for r in rows if r["viewer_kind"] == "anonymous"]
    first, last = rows[0]["viewed_at"], rows[-1]["viewed_at"]

    viewers: dict[str, dict] = {}
    for r in identified:
        v = viewers.setdefault(
            r["viewer_email"], {"views": 0, "assets": set(), "downloads": 0, "last": ""}
        )
        v["views"] += 1
        v["assets"].add(_asset(r))
        v["downloads"] += 1 if r["downloaded_at"] else 0
        v["last"] = max(v["last"], r["viewed_at"])

    assets: dict[str, dict] = {}
    for r in rows:
        a = assets.setdefault(_asset(r), {"views": 0, "identified": set(), "anonymous": 0})
        a["views"] += 1
        if r["viewer_kind"] == "declared_email":
            a["identified"].add(r["viewer_email"])
        else:
            a["anonymous"] += 1

    lines = [
        f"<!-- {REPORT_MARKER}:{batch_key} -->",
        "## Rapport factuel d'activité Papermark (IR Agent)",
        "",
        f"- Période observée : {first} → {last} (UTC)",
        f"- Vues : **{len(rows)}** — avec email déclaré : {len(identified)}, "
        f"anonymes : {len(anonymous)}",
        f"- Visiteurs distincts avec email déclaré : {len(viewers)}",
        f"- Lot : `{batch_key}`",
        "",
        "### Par document / data room",
        "",
        "| Actif | Vues | Emails déclarés distincts | Vues anonymes |",
        "|---|---:|---:|---:|",
    ]
    for name, a in sorted(assets.items(), key=lambda kv: (-kv[1]["views"], kv[0])):
        lines.append(f"| {_md(name)} | {a['views']} | {len(a['identified'])} | {a['anonymous']} |")

    lines += ["", "### Visiteurs avec email déclaré", ""]
    if viewers:
        lines += [
            "| Email déclaré | Vues | Téléchargements | Dernière vue (UTC) | Actifs consultés |",
            "|---|---:|---:|---|---|",
        ]
        ranked = sorted(viewers.items(), key=lambda kv: (-kv[1]["views"], kv[0]))
        for email, v in ranked[:MAX_VIEWERS_IN_REPORT]:
            lines.append(
                f"| {_md(email)} | {v['views']} | {v['downloads']} | {v['last']} | "
                f"{_md(', '.join(sorted(v['assets'])))} |"
            )
        if len(ranked) > MAX_VIEWERS_IN_REPORT:
            lines.append(f"\n_{len(ranked) - MAX_VIEWERS_IN_REPORT} autres visiteurs non listés._")
    else:
        lines.append("_Aucun._")

    lines += [
        "",
        "### Limites des données",
        "",
        "- Les emails sont **déclarés** par le visiteur ; le champ historique `verified` "
        "n'est pas utilisé (valeurs anciennes non fiables).",
        "- Les vues anonymes ne sont rattachées à aucune personne et ne doivent pas l'être.",
        "- Vues archivées et domaines internes exclus.",
        "",
        "### Consignes",
        "",
        "Ce rapport contient uniquement des faits collectés. L'interprétation commerciale "
        "revient au CMO. **Aucun email ou relance investisseur ne doit être envoyé sans "
        "approbation humaine explicite de Privann.**",
    ]
    title = f"IR — activité Papermark : {len(rows)} vue(s) jusqu'au {last[:10]} [{batch_key[:8]}]"
    return {
        "title": title,
        "description": "\n".join(lines),
        "stats": {
            "views": len(rows),
            "identified_views": len(identified),
            "anonymous_views": len(anonymous),
            "distinct_identified_viewers": len(viewers),
            "assets": len(assets),
            "period": [first, last],
        },
    }


# ── handoff ───────────────────────────────────────────────────────────────────


def freeze_new_batch(db) -> str | None:
    """Assign every unbatched, reportable view to a new pending batch."""
    with tx(db):
        ids = [
            r["view_id"]
            for r in db.execute(
                "SELECT view_id FROM views WHERE batch_key IS NULL AND skip_reason IS NULL"
            )
        ]
        if not ids:
            return None
        key = batch_key_for(ids)
        db.execute(
            "INSERT OR IGNORE INTO batches(batch_key,status,view_count,created_at) "
            "VALUES(?, 'pending', ?, ?)",
            (key, len(ids), now_iso()),
        )
        db.executemany("UPDATE views SET batch_key=? WHERE view_id=?", [(key, i) for i in ids])
    return key


def send_batch(db, cfg: Config, key: str) -> dict:
    rows = db.execute("SELECT * FROM views WHERE batch_key=?", (key,)).fetchall()
    report = build_report(rows, key)
    body = {
        "title": report["title"],
        "description": report["description"],
        "status": cfg.handoff_status,
        "priority": "medium",
        "assigneeAgentId": cfg.cmo_agent_id,
        "idempotencyKey": f"{REPORT_MARKER}:{key}",
        # Titles carry the batch key; idempotencyKey is the dedup authority.
        "allowDuplicate": True,
    }
    headers = {"Authorization": f"Bearer {cfg.paperclip_key}"}
    if cfg.run_id:
        headers["X-Paperclip-Run-Id"] = cfg.run_id
    db.execute("UPDATE batches SET attempts=attempts+1 WHERE batch_key=?", (key,))
    try:
        issue = http_json(
            "POST", f"{cfg.paperclip_url}/api/companies/{cfg.company_id}/issues",
            headers, body, err=PaperclipError,
        )
    except PaperclipError as e:
        db.execute("UPDATE batches SET last_error=? WHERE batch_key=?", (str(e), key))
        raise
    if not isinstance(issue, dict) or not issue.get("id"):
        raise PaperclipError("issue create returned no id")
    db.execute(
        "UPDATE batches SET status='sent', issue_id=?, issue_identifier=?, sent_at=?, "
        "last_error=NULL WHERE batch_key=?",
        (issue["id"], issue.get("identifier"), now_iso(), key),
    )
    return {"batch": key, "issue": issue.get("identifier") or issue["id"], **report["stats"]}


# ── entry points ──────────────────────────────────────────────────────────────


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def run_dry(cfg: Config, db_path: Path, show_report: bool) -> dict:
    """Read-only: fetches from Papermark from the persisted cursor (if any),
    writes nothing, calls nothing on Paperclip."""
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    if db_path.exists():
        src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = src.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()
        seen = {r[0] for r in src.execute("SELECT view_id FROM views")}
        src.close()
        if cur:
            db.execute("INSERT INTO meta VALUES('cursor',?)", (cur[0],))
    else:
        seen = set()
    result = collect(db, cfg, persist=False)
    rows = [r for r in _rows_from_api(result.pop("buffered"), cfg) if r["view_id"] not in seen]
    reportable = [r for r in rows if not r["skip_reason"]]
    out = {"mode": "dry-run", **result, "new_views": len(rows),
           "skipped": {}, "would_create_issue": bool(reportable)}
    for r in rows:
        if r["skip_reason"]:
            out["skipped"][r["skip_reason"]] = out["skipped"].get(r["skip_reason"], 0) + 1
    if reportable:
        key = batch_key_for([r["view_id"] for r in reportable])
        report = build_report(reportable, key)
        out.update(batch=key, title=report["title"], stats=report["stats"],
                   idempotency_key=f"{REPORT_MARKER}:{key}",
                   handoff_status=cfg.handoff_status)
        if show_report:
            desc = report["description"]
            for r in reportable:
                if r["viewer_email"]:
                    desc = desc.replace(r["viewer_email"], mask_email(r["viewer_email"]))
            out["report_preview_masked"] = desc
    return out


def run_live(cfg: Config, db_path: Path) -> dict:
    db = open_state(db_path)
    collected = collect(db, cfg, persist=True)
    collected.pop("buffered")
    sent, errors = [], []
    pending = [r["batch_key"] for r in db.execute(
        "SELECT batch_key FROM batches WHERE status='pending' ORDER BY created_at")]
    new_key = freeze_new_batch(db)
    if new_key and new_key not in pending:
        pending.append(new_key)
    for key in pending:
        try:
            sent.append(send_batch(db, cfg, key))
        except PaperclipError as e:
            errors.append({"batch": key, "error": str(e)})
    out = {"mode": "live", **collected, "sent": sent,
           "pending_after_run": [e["batch"] for e in errors]}
    if errors:
        out["errors"] = errors
    return out


def main(argv=None, env=None) -> int:
    ap = argparse.ArgumentParser(description="JETT IR Agent: Papermark views -> Paperclip report")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and build the report; write nothing, call no Paperclip API")
    ap.add_argument("--show-report", action="store_true",
                    help="with --dry-run: include the report with masked emails")
    args = ap.parse_args(argv)
    env = dict(os.environ if env is None else env)
    try:
        cfg = load_config(env, need_paperclip=not args.dry_run)
    except ConfigError as e:
        print(json.dumps({"ok": False, "error": f"config: {e}"}))
        return EXIT_CONFIG
    db_path = cfg.state_dir / "state.db"
    try:
        with run_lock(cfg.state_dir):
            out = run_dry(cfg, db_path, args.show_report) if args.dry_run else run_live(cfg, db_path)
    except RuntimeError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return EXIT_LOCKED
    except PapermarkError as e:
        print(json.dumps({"ok": False, "error": f"papermark: {e}"}))
        return EXIT_PAPERMARK
    out["ok"] = not out.get("errors")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return EXIT_OK if out["ok"] else EXIT_PAPERCLIP


if __name__ == "__main__":
    sys.exit(main())
