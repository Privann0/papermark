// Pure helpers for the incremental IR views feed (pages/api/agent/ir/views.ts).
// Kept free of Prisma/Next imports so they can be unit-tested in isolation.

export const IR_VIEWS_DEFAULT_LIMIT = 100;
export const IR_VIEWS_MAX_LIMIT = 500;

// Views are only served once they are older than this window. View.viewedAt is
// set at insert time, so a transaction that commits late could otherwise land
// behind a cursor that has already moved past it.
export const IR_VIEWS_SETTLE_MS = 2 * 60 * 1000;

// A token must hold one of these scopes. Null scopes are legacy "apis.all"
// (see migration 20260425000000_normalize_token_scopes).
const ACCEPTED_SCOPES = ["apis.all", "apis.read", "analytics.read"];

export function tokenHasIrReadScope(scopes: string | null): boolean {
  if (scopes === null) return true;
  const granted = scopes.split(/\s+/).filter(Boolean);
  return granted.some((s) => ACCEPTED_SCOPES.includes(s));
}

export type IrCursor = { viewedAt: Date; id: string };

export function encodeCursor(cursor: IrCursor): string {
  return Buffer.from(
    `${cursor.viewedAt.toISOString()}|${cursor.id}`,
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(raw: unknown): IrCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) {
    return null;
  }
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  if (sep <= 0) return null;
  const viewedAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(viewedAt.getTime()) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return null;
  }
  return { viewedAt, id };
}

export function parseLimit(raw: unknown): number {
  const n =
    typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return IR_VIEWS_DEFAULT_LIMIT;
  return Math.min(n, IR_VIEWS_MAX_LIMIT);
}

// Optional lower bound (inclusive) used when no cursor is given: first sync
// from an operational start date, or re-scanning an overlap window.
// Requires an explicit timezone so "2026-09-29" can't silently mean UTC.
export function parseSince(raw: unknown): Date | null | "invalid" {
  if (raw === undefined) return null;
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      raw,
    )
  ) {
    return "invalid";
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

// Keyset condition: strictly after (viewedAt, id), ordered ascending.
export function afterCursorWhere(cursor: IrCursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { viewedAt: { gt: cursor.viewedAt } },
      { viewedAt: cursor.viewedAt, id: { gt: cursor.id } },
    ],
  };
}

export function buildViewsWhere(input: {
  teamId: string;
  cursor: IrCursor | null;
  since: Date | null;
  settledBefore: Date;
}) {
  return {
    link: { teamId: input.teamId },
    viewedAt: {
      lte: input.settledBefore,
      ...(input.since ? { gte: input.since } : {}),
    },
    ...afterCursorWhere(input.cursor),
  };
}

export type IrViewRow = {
  id: string;
  viewedAt: Date;
  downloadedAt: Date | null;
  viewType: string;
  viewerEmail: string | null;
  isArchived: boolean;
  linkId: string;
  documentId: string | null;
  dataroomId: string | null;
  link: { name: string | null; slug: string | null } | null;
  document: { name: string } | null;
  dataroom: { name: string } | null;
};

// Factual, minimal projection. Deliberately omits View.verified (historical
// values are unreliable), viewer names, IPs, geo and user agents.
export function serializeView(v: IrViewRow) {
  const email = v.viewerEmail?.trim().toLowerCase() || null;
  return {
    viewId: v.id,
    viewedAt: v.viewedAt.toISOString(),
    downloadedAt: v.downloadedAt ? v.downloadedAt.toISOString() : null,
    viewType: v.viewType,
    archived: v.isArchived,
    viewer: email
      ? { kind: "declared_email" as const, email }
      : { kind: "anonymous" as const },
    link: { id: v.linkId, name: v.link?.name ?? v.link?.slug ?? null },
    document: v.documentId
      ? { id: v.documentId, name: v.document?.name ?? null }
      : null,
    dataroom: v.dataroomId
      ? { id: v.dataroomId, name: v.dataroom?.name ?? null }
      : null,
  };
}
