"""Run: python3 -m unittest discover -s integrations/ir-agent -v"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import ir_agent

TOKEN = "pmk_test_SECRET_do_not_log"
PC_KEY = "pcp_run_jwt_SECRET"
CMO = "174c6f3f-e5e2-41ac-b6a8-1e3f4080bd37"
COMPANY = "be04a27e-2849-4a64-9abf-3c15ac1802a0"


def make_view(i, email=None, archived=False, doc="Deck", room=None):
    return {
        "viewId": f"v{i:04d}",
        "viewedAt": f"2026-09-{1 + i // 100:02d}T10:{(i // 60) % 60:02d}:{i % 60:02d}.000Z",
        "downloadedAt": None,
        "viewType": "DATAROOM_VIEW" if room else "DOCUMENT_VIEW",
        "archived": archived,
        "viewer": {"kind": "declared_email", "email": email} if email else {"kind": "anonymous"},
        "link": {"id": "l1", "name": "Seed link"},
        "document": {"id": "d1", "name": doc} if doc else None,
        "dataroom": {"id": "r1", "name": room} if room else None,
    }


def key_of(v):
    return (ir_agent.parse_ts(v["viewedAt"]), v["viewId"])


class FakeServers:
    """Papermark /api/agent/ir/views + Paperclip /api/companies/:id/issues."""

    def __init__(self):
        self.views: list[dict] = []
        self.queries: list[dict] = []
        self.papermark_fail_on_call: set[int] = set()
        self.papermark_calls = 0
        self.issues_by_key: dict[str, dict] = {}
        self.issue_posts: list[dict] = []
        self.paperclip_mode = "ok"  # ok | error | lose_response_once
        self.seen_auth: list[str] = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj):
                data = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                u = urllib.parse.urlsplit(self.path)
                if u.path != "/api/agent/ir/views":
                    return self._send(404, {})
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    return self._send(401, {"error": "Invalid token"})
                fake.papermark_calls += 1
                if fake.papermark_calls in fake.papermark_fail_on_call:
                    return self._send(500, {"error": "boom"})
                # Same semantics as pages/api/agent/ir/views.ts: keyset on
                # (viewedAt, id) ascending, optional inclusive `since`.
                q = urllib.parse.parse_qs(u.query)
                fake.queries.append(q)
                cursor = q.get("cursor", [None])[0]
                since = q.get("since", [None])[0]
                limit = int(q.get("limit", ["100"])[0])
                rows = sorted(fake.views, key=key_of)
                if since:
                    rows = [v for v in rows if ir_agent.parse_ts(v["viewedAt"]) >= ir_agent.parse_ts(since)]
                if cursor:
                    at, vid = cursor.split("|")
                    rows = [v for v in rows if key_of(v) > (ir_agent.parse_ts(at), vid)]
                page, has_more = rows[:limit], len(rows) > limit
                last = page[-1] if page else None
                next_cursor = f"{last['viewedAt']}|{last['viewId']}" if last else cursor
                self._send(200, {"views": page, "nextCursor": next_cursor, "hasMore": has_more})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path != f"/api/companies/{COMPANY}/issues":
                    return self._send(404, {})
                fake.seen_auth.append(self.headers.get("Authorization"))
                fake.issue_posts.append(body)
                if fake.paperclip_mode == "error":
                    return self._send(503, {"error": "down"})
                key = body["idempotencyKey"]
                issue = fake.issues_by_key.get(key)
                if not issue:
                    issue = {"id": f"issue-{len(fake.issues_by_key) + 1}",
                             "identifier": f"JET-{len(fake.issues_by_key) + 1}", **body}
                    fake.issues_by_key[key] = issue
                if fake.paperclip_mode == "lose_response_once":
                    fake.paperclip_mode = "ok"
                    return self._send(500, {"error": "created but response lost"})
                self._send(201, issue)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


class IrAgentTest(unittest.TestCase):
    def setUp(self):
        self.srv = FakeServers()
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "state"
        tok = Path(self.tmp.name) / "papermark.token"
        tok.write_text(TOKEN + "\n")
        tok.chmod(0o600)
        self.env = {
            "IR_PAPERMARK_URL": self.srv.url,
            "IR_ALLOW_HTTP": "1",
            "IR_PAPERMARK_TOKEN_FILE": str(tok),
            "IR_STATE_DIR": str(self.state),
            "IR_CMO_AGENT_ID": CMO,
            "IR_SYNC_START": "2026-09-01T00:00:00Z",
            "IR_EXCLUDE_EMAIL_DOMAINS": "jett.city",
            "PAPERCLIP_API_URL": self.srv.url,
            "PAPERCLIP_API_KEY": PC_KEY,
            "PAPERCLIP_COMPANY_ID": COMPANY,
            "PAPERCLIP_RUN_ID": "run-1",
        }
        # no real sleeping on retries
        self._sleep = mock.patch.object(ir_agent.time, "sleep", lambda s: None)
        self._sleep.start()

    def tearDown(self):
        self._sleep.stop()
        self.srv.close()
        self.tmp.cleanup()

    def run_agent(self, *args, env=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = ir_agent.main(list(args), env or self.env)
        for text in (out.getvalue(), err.getvalue()):
            self.assertNotIn(TOKEN, text)
            self.assertNotIn(PC_KEY, text)
        return code, out.getvalue()

    def db(self):
        return sqlite3.connect(self.state / "state.db")

    # ── collection ──────────────────────────────────────────────────────────

    def test_paginates_and_is_incremental(self):
        self.srv.views = [make_view(i, email=f"inv{i % 7}@fund.com") for i in range(450)]
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        res = json.loads(out)
        self.assertEqual((res["pages"], res["inserted"]), (3, 450))
        self.assertEqual(len(self.srv.issues_by_key), 1)
        # second run: nothing new → no new issue
        code, out = self.run_agent()
        res = json.loads(out)
        self.assertEqual((res["inserted"], res["sent"]), (0, []))
        self.assertEqual(len(self.srv.issue_posts), 1)
        # new views → one more issue, only with the new views
        self.srv.views += [make_view(i, email="new@fund.com") for i in range(450, 455)]
        code, out = self.run_agent()
        res = json.loads(out)
        self.assertEqual(res["inserted"], 5)
        self.assertEqual(res["sent"][0]["views"], 5)
        self.assertEqual(len(self.srv.issues_by_key), 2)

    def test_resumes_after_papermark_failure_without_duplicates(self):
        self.srv.views = [make_view(i) for i in range(450)]
        self.srv.papermark_fail_on_call = {2, 3, 4}  # page 2 fails through all retries
        code, out = self.run_agent()
        self.assertEqual(code, ir_agent.EXIT_PAPERMARK, out)
        self.assertEqual(self.srv.issue_posts, [])
        with self.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM views").fetchone()[0], 200)
            v199 = sorted(self.srv.views, key=key_of)[199]
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()[0],
                             f"{v199['viewedAt']}|{v199['viewId']}")
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        with self.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM views").fetchone()[0], 450)
        self.assertEqual(len(self.srv.issues_by_key), 1)
        self.assertEqual(json.loads(out)["sent"][0]["views"], 450)

    # ── late inserts & overlap window ───────────────────────────────────────

    def test_late_insert_behind_cursor_is_caught_by_overlap(self):
        self.srv.views = [make_view(i, email="a@fund.com") for i in range(10)]  # 10:00:00..09
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        # A view stamped 10:00:03 whose transaction committed only now: the
        # cursor (10:00:09) is already past it, so the keyset scan can't see it.
        late = make_view(3, email="late@fund.com")
        late["viewId"] = "v0003-late"
        self.srv.views.append(late)
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        res = json.loads(out)
        self.assertEqual((res["inserted"], res["late_inserted"]), (0, 1))
        self.assertEqual(res["sent"][0]["views"], 1)
        self.assertEqual(len(self.srv.issues_by_key), 2)
        self.assertIn("late@fund.com", self.srv.issue_posts[-1]["description"])
        # overlap re-reads never move the cursor and never re-report
        code, out = self.run_agent()
        res = json.loads(out)
        self.assertEqual((res["late_inserted"], res["sent"]), (0, []))
        with self.db() as db:
            cur = db.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()[0]
        self.assertEqual(cur, "2026-09-01T10:00:09.000Z|v0009")

    def test_late_insert_older_than_overlap_is_not_caught(self):
        """Documented limit: the overlap bounds how late a commit may be."""
        self.srv.views = [make_view(0), make_view(500)]  # 2026-09-01 and 2026-09-06
        self.run_agent(env={**self.env, "IR_OVERLAP_HOURS": "24"})
        late = make_view(1)  # 2026-09-01, 5 days behind the cursor
        late["viewId"] = "v0001-late"
        self.srv.views.append(late)
        code, out = self.run_agent(env={**self.env, "IR_OVERLAP_HOURS": "24"})
        self.assertEqual(json.loads(out)["late_inserted"], 0)

    def test_overlap_scan_is_bounded_by_sync_start(self):
        self.srv.views = [make_view(0)]
        self.run_agent(env={**self.env, "IR_OVERLAP_HOURS": "720"})
        since = [q["since"][0] for q in self.srv.queries if "since" in q]
        self.assertTrue(since)
        self.assertTrue(all(s >= "2026-09-01T00:00:00.000Z" for s in since))

    # ── operational start & historical report ───────────────────────────────

    def test_sync_start_excludes_history_from_tickets(self):
        old = [make_view(i, email=f"old{i}@fund.com") for i in range(3)]
        for v in old:
            v["viewedAt"] = v["viewedAt"].replace("2026-09-01", "2026-08-15")
        self.srv.views = old + [make_view(10, email="new@fund.com")]
        env = {**self.env, "IR_SYNC_START": "2026-09-01T00:00:00+02:00"}
        code, out = self.run_agent(env=env)
        self.assertEqual(code, 0, out)
        res = json.loads(out)
        self.assertEqual(res["sync_start"], "2026-08-31T22:00:00.000Z")
        self.assertEqual(res["sent"][0]["views"], 1)
        self.assertEqual(self.srv.queries[0]["since"], ["2026-08-31T22:00:00.000Z"])
        self.assertNotIn("old0@fund.com", self.srv.issue_posts[0]["description"])

    def test_first_run_requires_sync_start_and_it_cannot_drift(self):
        env = {k: v for k, v in self.env.items() if k != "IR_SYNC_START"}
        self.srv.views = [make_view(0)]
        for args in ((), ("--dry-run",)):
            code, out = self.run_agent(*args, env=env)
            self.assertEqual(code, ir_agent.EXIT_CONFIG, out)
            self.assertIn("IR_SYNC_START", out)
        self.assertEqual(self.srv.queries, [])
        self.assertEqual(self.run_agent()[0], 0)
        # once recorded, the env var may be dropped but not changed
        self.assertEqual(self.run_agent(env=env)[0], 0)
        code, out = self.run_agent(env={**self.env, "IR_SYNC_START": "2026-01-01T00:00:00Z"})
        self.assertEqual(code, ir_agent.EXIT_CONFIG)
        self.assertIn("differs", out)

    def test_naive_sync_start_is_rejected(self):
        code, out = self.run_agent("--dry-run", env={**self.env, "IR_SYNC_START": "2026-09-29"})
        self.assertEqual(code, ir_agent.EXIT_CONFIG)

    def test_historical_report_is_separate_and_creates_no_ticket(self):
        old = [make_view(i, email="lp@fund.com") for i in range(4)]
        for v in old:
            v["viewedAt"] = v["viewedAt"].replace("2026-09-01", "2026-08-15")
        self.srv.views = old + [make_view(10, email="new@fund.com")]
        report = Path(self.tmp.name) / "historique.md"
        env = {k: v for k, v in self.env.items() if not k.startswith("PAPERCLIP_")}
        code, out = self.run_agent("--historical-report", str(report), env=env)
        self.assertEqual(code, 0, out)
        res = json.loads(out)
        self.assertEqual(res["stats"]["views"], 4)
        self.assertNotIn("lp@fund.com", out)
        text = report.read_text()
        self.assertIn("Rapport historique", text)
        self.assertIn("lp@fund.com", text)
        self.assertNotIn("new@fund.com", text)
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.srv.issue_posts, [])
        self.assertFalse((self.state / "state.db").exists())
        # never overwrites an existing report
        code, out = self.run_agent("--historical-report", str(report), env=env)
        self.assertEqual(code, ir_agent.EXIT_CONFIG)
        # and the operational sync afterwards still ignores that history
        self.run_agent()
        self.assertEqual(len(self.srv.issue_posts), 1)
        self.assertNotIn("lp@fund.com", self.srv.issue_posts[0]["description"])

    # ── handoff ─────────────────────────────────────────────────────────────

    def test_paperclip_down_then_retry_same_batch(self):
        self.srv.views = [make_view(i, email="a@fund.com") for i in range(3)]
        self.srv.paperclip_mode = "error"
        code, out = self.run_agent()
        self.assertEqual(code, ir_agent.EXIT_PAPERCLIP)
        res = json.loads(out)
        self.assertEqual(len(res["pending_after_run"]), 1)
        self.srv.paperclip_mode = "ok"
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        keys = {p["idempotencyKey"] for p in self.srv.issue_posts}
        self.assertEqual(len(keys), 1)
        self.assertEqual(len(self.srv.issues_by_key), 1)

    def test_lost_response_is_replayed_not_duplicated(self):
        self.srv.views = [make_view(i, email="a@fund.com") for i in range(3)]
        self.srv.paperclip_mode = "lose_response_once"
        code, out = self.run_agent()
        # the http retry inside the same run replays via idempotencyKey
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.srv.issue_posts), 2)
        self.assertEqual(len(self.srv.issues_by_key), 1)
        with self.db() as db:
            row = db.execute("SELECT status, issue_identifier, attempts FROM batches").fetchone()
        self.assertEqual(row, ("sent", "JET-1", 1))

    def test_issue_payload_contract(self):
        self.srv.views = [make_view(0, email="a@fund.com"), make_view(1)]
        self.run_agent()
        body = self.srv.issue_posts[0]
        self.assertEqual(body["assigneeAgentId"], CMO)
        self.assertEqual(body["status"], "backlog")  # no automatic CMO wake by default
        self.assertTrue(body["idempotencyKey"].startswith("jett-ir-report:"))
        self.assertIs(body["allowDuplicate"], True)
        self.assertIn(body["idempotencyKey"].split(":")[1][:8], body["title"])
        self.assertEqual(self.srv.seen_auth[0], f"Bearer {PC_KEY}")
        self.assertIn("approbation humaine", body["description"])

    def test_handoff_status_todo_is_opt_in(self):
        self.srv.views = [make_view(0)]
        self.run_agent(env={**self.env, "IR_HANDOFF_STATUS": "todo"})
        self.assertEqual(self.srv.issue_posts[0]["status"], "todo")
        code, out = self.run_agent(env={**self.env, "IR_HANDOFF_STATUS": "done"})
        self.assertEqual(code, ir_agent.EXIT_CONFIG)

    # ── report content ──────────────────────────────────────────────────────

    def test_anonymous_internal_and_archived(self):
        self.srv.views = [
            make_view(0, email="Investor@Fund.com".lower()),
            make_view(1, email="investor@fund.com", room="Seed room"),
            make_view(2),
            make_view(3),
            make_view(4, email="privann@jett.city"),
            make_view(5, email="old@fund.com", archived=True),
        ]
        code, out = self.run_agent()
        self.assertEqual(code, 0, out)
        stats = json.loads(out)["sent"][0]
        self.assertEqual(stats["views"], 4)
        self.assertEqual(stats["identified_views"], 2)
        self.assertEqual(stats["anonymous_views"], 2)
        self.assertEqual(stats["distinct_identified_viewers"], 1)
        desc = self.srv.issue_posts[0]["description"]
        self.assertNotIn("privann@jett.city", desc)
        self.assertNotIn("old@fund.com", desc)
        self.assertNotIn("HOT", desc)
        self.assertNotIn("verified", desc.replace("`verified`", ""))
        # emails never land in run logs
        self.assertNotIn("investor@fund.com", out)
        with self.db() as db:
            skipped = dict(db.execute(
                "SELECT view_id, skip_reason FROM views WHERE skip_reason IS NOT NULL"))
        self.assertEqual(skipped, {"v0004": "internal_domain", "v0005": "archived"})

    def test_markdown_injection_is_escaped(self):
        self.srv.views = [make_view(0, email="a@fund.com", doc="Deck | evil\n# x")]
        self.run_agent()
        desc = self.srv.issue_posts[0]["description"]
        self.assertIn("Deck \\| evil # x", desc)

    # ── dry-run & safety ────────────────────────────────────────────────────

    def test_dry_run_writes_nothing_and_calls_no_paperclip(self):
        self.srv.views = [make_view(i, email="a@fund.com") for i in range(5)]
        env = {k: v for k, v in self.env.items() if not k.startswith("PAPERCLIP_")}
        code, out = self.run_agent("--dry-run", "--show-report", env=env)
        self.assertEqual(code, 0, out)
        res = json.loads(out)
        self.assertTrue(res["would_create_issue"])
        self.assertEqual(res["new_views"], 5)
        self.assertIn("a***@fund.com", res["report_preview_masked"])
        self.assertNotIn("a@fund.com", out)
        self.assertFalse((self.state / "state.db").exists())
        self.assertEqual(self.srv.issue_posts, [])

    def test_dry_run_after_live_only_shows_new_views(self):
        self.srv.views = [make_view(i) for i in range(5)]
        self.run_agent()
        self.srv.views.append(make_view(5))
        code, out = self.run_agent("--dry-run")
        res = json.loads(out)
        self.assertEqual(res["new_views"], 1)
        self.assertEqual(len(self.srv.issue_posts), 1)

    def test_rejects_world_readable_token_file(self):
        Path(self.env["IR_PAPERMARK_TOKEN_FILE"]).chmod(0o644)
        code, out = self.run_agent("--dry-run")
        self.assertEqual(code, ir_agent.EXIT_CONFIG)
        self.assertIn("chmod 600", out)

    def test_requires_https_by_default(self):
        env = {k: v for k, v in self.env.items() if k != "IR_ALLOW_HTTP"}
        code, _ = self.run_agent("--dry-run", env=env)
        self.assertEqual(code, ir_agent.EXIT_CONFIG)

    def test_live_requires_paperclip_runtime_env(self):
        env = {k: v for k, v in self.env.items() if k != "PAPERCLIP_API_KEY"}
        code, out = self.run_agent(env=env)
        self.assertEqual(code, ir_agent.EXIT_CONFIG)
        self.assertIn("PAPERCLIP_API_KEY", out)

    def test_concurrent_run_is_refused(self):
        with ir_agent.run_lock(self.state):
            code, out = self.run_agent("--dry-run")
        self.assertEqual(code, ir_agent.EXIT_LOCKED)

    def test_state_file_is_private(self):
        self.srv.views = [make_view(0)]
        self.run_agent()
        self.assertEqual(os.stat(self.state / "state.db").st_mode & 0o077, 0)


if __name__ == "__main__":
    unittest.main()
