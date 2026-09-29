// Run: npx tsx --test lib/agent/ir-views.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IR_VIEWS_DEFAULT_LIMIT,
  IR_VIEWS_MAX_LIMIT,
  afterCursorWhere,
  decodeCursor,
  encodeCursor,
  parseLimit,
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
    const c = { viewedAt: new Date("2026-09-01T10:00:00.123Z"), id: "clx123abc" };
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

describe("parseLimit", () => {
  it("defaults and clamps", () => {
    assert.equal(parseLimit(undefined), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("0"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("abc"), IR_VIEWS_DEFAULT_LIMIT);
    assert.equal(parseLimit("25"), 25);
    assert.equal(parseLimit("99999"), IR_VIEWS_MAX_LIMIT);
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
    assert.deepEqual(out.viewer, { kind: "declared_email", email: "jane@fund.com" });
    assert.equal("verified" in out, false);
    assert.equal("viewerName" in out, false);
  });
});
