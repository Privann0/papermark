// Run: npx tsx --test lib/agent/ir-views.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IR_VIEWS_DEFAULT_LIMIT,
  IR_VIEWS_MAX_LIMIT,
  afterCursorWhere,
  buildViewsWhere,
  decodeCursor,
  encodeCursor,
  parseLimit,
  parseSince,
  serializeView,
  tokenHasIrReadScope,
} from "./ir-views";

describe("tokenHasIrReadScope", () => {
  it("accepts legacy null scopes and read presets", () => {
    assert.equal(tokenHasIrReadScope(null), true);
    assert.equal(tokenHasIrReadScope("apis.all"), true);
    assert.equal(tokenHasIrReadScope("apis.read"), true);
    assert.equal(tokenHasIrReadScope("documents.read analytics.read"), true);
  });
  it("rejects tokens without an analytics scope", () => {
    assert.equal(tokenHasIrReadScope(""), false);
    assert.equal(tokenHasIrReadScope("documents.write links.read"), false);
  });
});

describe("cursor", () => {
  it("round-trips", () => {
    const c = {
      viewedAt: new Date("2026-09-01T10:00:00.123Z"),
      id: "clx123abc",
    };
    const back = decodeCursor(encodeCursor(c));
    assert.deepEqual(back, c);
  });
  it("rejects garbage", () => {
    assert.equal(decodeCursor(undefined), null);
    assert.equal(decodeCursor(""), null);
    assert.equal(decodeCursor("not-base64-|"), null);
    assert.equal(
      decodeCursor(Buffer.from("nope|id").toString("base64url")),
      null,
    );
    assert.equal(
      decodeCursor(
        Buffer.from("2026-01-01T00:00:00Z|bad id;drop").toString("base64url"),
      ),
      null,
    );
    assert.equal(decodeCursor(["a"]), null);
  });
  it("builds a strict keyset condition", () => {
    assert.deepEqual(afterCursorWhere(null), {});
    const at = new Date("2026-09-01T00:00:00Z");
    assert.deepEqual(afterCursorWhere({ viewedAt: at, id: "b" }), {
      OR: [{ viewedAt: { gt: at } }, { viewedAt: at, id: { gt: "b" } }],
    });
  });
});

describe("parseSince", () => {
  it("accepts ISO datetimes with an explicit timezone", () => {
    assert.equal(parseSince(undefined), null);
    assert.deepEqual(
      parseSince("2026-09-29T00:00:00+02:00"),
      new Date("2026-09-28T22:00:00Z"),
    );
    assert.deepEqual(
      parseSince("2026-09-29T00:00Z"),
      new Date("2026-09-29T00:00:00Z"),
    );
  });
  it("rejects naive or malformed values", () => {
    assert.equal(parseSince("2026-09-29"), "invalid");
    assert.equal(parseSince("2026-09-29T00:00:00"), "invalid");
    assert.equal(parseSince("2026-13-45T00:00:00Z"), "invalid");
    assert.equal(parseSince(["2026-09-29T00:00:00Z"]), "invalid");
  });
});

describe("buildViewsWhere", () => {
  const settledBefore = new Date("2026-09-29T10:00:00Z");
  it("always scopes to the token's team and the settle window", () => {
    assert.deepEqual(
      buildViewsWhere({
        teamId: "t1",
        cursor: null,
        since: null,
        settledBefore,
      }),
      { link: { teamId: "t1" }, viewedAt: { lte: settledBefore } },
    );
  });
  it("combines since and cursor without dropping the settle bound", () => {
    const since = new Date("2026-09-28T22:00:00Z");
    const at = new Date("2026-09-29T08:00:00Z");
    const where = buildViewsWhere({
      teamId: "t1",
      cursor: { viewedAt: at, id: "c1" },
      since,
      settledBefore,
    });
    assert.deepEqual(where.viewedAt, { lte: settledBefore, gte: since });
    assert.deepEqual(where.link, { teamId: "t1" });
    assert.equal(where.OR?.length, 2);
  });
});

describe("parseLimit", () => {
  it("defaults and clamps", () => {
    assert.equal(parseLimit(undefined), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("0"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("abc"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("25"), 25);
    assert.equal(parseLimit("99999"), IR_VIEWS_MAX_LIMIT);
    assert.equal(parseLimit("500"), 500);
    assert.equal(parseLimit("501"), IR_VIEWS_MAX_LIMIT);
    assert.equal(parseLimit("10abc"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("-5"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("1e3"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit(["5", "6"]), IR_VIEWS_DEFAULT_LIMIT);
  });
});

describe("serializeView", () => {
  const base = {
    id: "v1",
    viewedAt: new Date("2026-09-01T00:00:00Z"),
    downloadedAt: null,
    viewType: "DOCUMENT_VIEW",
    viewerEmail: null as string | null,
    isArchived: false,
    linkId: "l1",
    documentId: "d1",
    dataroomId: null,
    link: { name: null, slug: "deck" },
    document: { name: "Deck" },
    dataroom: null,
  };
  it("keeps anonymous views anonymous", () => {
    const out = serializeView(base);
    assert.deepEqual(out.viewer, { kind: "anonymous" });
    assert.equal(out.link.name, "deck");
    assert.equal(out.dataroom, null);
  });
  it("normalises declared emails and never exposes verified", () => {
    const out = serializeView({ ...base, viewerEmail: "  Jane@Fund.COM " });
    assert.deepEqual(out.viewer, {
      kind: "declared_email",
      email: "jane@fund.com",
    });
    assert.equal("verified" in out, false);
    assert.equal("viewerName" in out, false);
  });
});
