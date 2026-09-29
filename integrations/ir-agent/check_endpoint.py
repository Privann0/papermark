#!/usr/bin/env python3
"""Read-only contract check of GET /api/agent/ir/views on a live Papermark.

Prints PASS/FAIL lines and counts only: never the key, emails or document names.
Usage: IR_PAPERMARK_TOKEN_FILE=... python3 check_endpoint.py [--url https://room.jett.city]
       [--since 2026-09-29T00:00:00+02:00]
Exit code 0 when every check passes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ir_agent import ConfigError, _read_secret, parse_ts  # noqa: E402

EXPECTED_KEYS = {"viewId", "viewedAt", "downloadedAt", "viewType", "archived",
                 "viewer", "link", "document", "dataroom"}
FORBIDDEN_KEYS = {"verified", "viewerName", "viewerEmail", "ip", "country", "city", "ua"}


def call(base: str, params: dict, token: str | None, method: str = "GET"):
    url = f"{base}/api/agent/ir/views"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"Accept": "application/json", "User-Agent": "jett-ir-check/1"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        e.close()
        return e.code, None
    except (urllib.error.URLError, ConnectionError, TimeoutError, ValueError):
        return 0, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://room.jett.city")
    ap.add_argument("--since", default="2026-09-29T00:00:00+02:00")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    try:
        token = _read_secret(dict(os.environ), "IR_PAPERMARK_TOKEN")
    except ConfigError as e:
        print(f"FAIL config: {e}")
        return 2

    results: list[tuple[bool, str]] = []

    def check(ok: bool, label: str):
        results.append((ok, label))
        print(("PASS " if ok else "FAIL ") + label)

    check(call(base, {}, None)[0] == 401, "no token -> 401")
    check(call(base, {}, "invalid-key-for-check")[0] == 401, "unknown token -> 401")
    check(call(base, {}, token, "POST")[0] == 405, "POST -> 405")
    check(call(base, {"since": "2026-09-29"}, token)[0] == 400, "since without timezone -> 400")
    check(call(base, {"cursor": "!!bad!!"}, token)[0] == 400, "malformed cursor -> 400")

    status, body = call(base, {"limit": "1000", "since": args.since}, token)
    check(status == 200 and isinstance(body, dict), "valid token -> 200")
    if status != 200 or not isinstance(body, dict):
        return 1
    views = body.get("views") or []
    check(len(views) <= 500, f"limit clamped to 500 (got {len(views)} views since {args.since})")
    keys_ok = all(set(v) == EXPECTED_KEYS for v in views)
    check(keys_ok, "fields = documented contract")
    check(not any(FORBIDDEN_KEYS & set(v) for v in views), "no verified/name/network fields")
    check(all(v["viewer"]["kind"] in ("anonymous", "declared_email") for v in views),
          "viewer.kind in {anonymous, declared_email}")
    check(all(("email" in v["viewer"]) == (v["viewer"]["kind"] == "declared_email") for v in views),
          "email present only for declared_email")
    since = parse_ts(args.since)
    settled = parse_ts(body["settledBefore"])
    check(all(since <= parse_ts(v["viewedAt"]) <= settled for v in views),
          "since <= viewedAt <= settledBefore (settle window)")
    anon = sum(v["viewer"]["kind"] == "anonymous" for v in views)
    print(f"INFO {len(views)} views, {anon} anonymous, {len(views) - anon} declared email, "
          f"{sum(bool(v['archived']) for v in views)} archived, hasMore={body.get('hasMore')}")

    # Page one view at a time: strict (viewedAt, viewId) order, no duplicate, same set.
    seen, keys, cursor, pages = [], [], None, 0
    while pages < 600:
        params = {"limit": "1", "since": args.since}
        if cursor:
            params["cursor"] = cursor
        st, page = call(base, params, token)
        if st != 200 or not isinstance(page, dict):
            check(False, f"paging request {pages + 1} -> {st}")
            break
        pages += 1
        for v in page["views"]:
            seen.append(v["viewId"])
            keys.append((parse_ts(v["viewedAt"]), v["viewId"]))
        cursor = page.get("nextCursor")
        if not page.get("hasMore"):
            break
    check(keys == sorted(keys) and len(set(keys)) == len(keys), f"strict order over {pages} pages")
    check(len(set(seen)) == len(seen), "no duplicate viewId across pages")
    big_ids = {v["viewId"] for v in views}
    check(big_ids <= set(seen), "limit=1 paging covers the limit=500 page")

    failed = [label for ok, label in results if not ok]
    print(f"{'OK' if not failed else 'KO'}: {len(results) - len(failed)}/{len(results)} checks passed")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
