import { NextApiRequest, NextApiResponse } from "next";

import {
  IR_VIEWS_SETTLE_MS,
  buildViewsWhere,
  decodeCursor,
  encodeCursor,
  parseLimit,
  parseSince,
  serializeView,
  tokenHasIrReadScope,
} from "@/lib/agent/ir-views";
import { hashToken } from "@/lib/api/auth/token";
import prisma from "@/lib/prisma";

// Incremental, append-only feed of views for the IR Agent.
// GET /api/agent/ir/views?cursor=<opaque>&since=<ISO 8601 + tz>&limit=<1..500>
// Stable keyset pagination on (viewedAt, id); pass back `nextCursor` to resume.
// `since` is an inclusive lower bound on viewedAt, combinable with `cursor`.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const tokenRecord = await prisma.restrictedToken.findUnique({
    where: { hashedKey: hashToken(authHeader.slice(7)) },
    select: { id: true, teamId: true, scopes: true, expires: true },
  });
  if (
    !tokenRecord ||
    (tokenRecord.expires && tokenRecord.expires < new Date())
  ) {
    return res.status(401).json({ error: "Invalid token" });
  }
  if (!tokenHasIrReadScope(tokenRecord.scopes)) {
    return res.status(403).json({ error: "Insufficient scope" });
  }

  const cursor = decodeCursor(req.query.cursor);
  if (req.query.cursor !== undefined && !cursor) {
    return res.status(400).json({ error: "Invalid cursor" });
  }
  const since = parseSince(req.query.since);
  if (since === "invalid") {
    return res
      .status(400)
      .json({ error: "Invalid since (ISO 8601 with timezone expected)" });
  }
  const limit = parseLimit(req.query.limit);
  const settledBefore = new Date(Date.now() - IR_VIEWS_SETTLE_MS);

  const rows = await prisma.view.findMany({
    where: buildViewsWhere({
      teamId: tokenRecord.teamId,
      cursor,
      since,
      settledBefore,
    }),
    orderBy: [{ viewedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      viewedAt: true,
      downloadedAt: true,
      viewType: true,
      viewerEmail: true,
      isArchived: true,
      linkId: true,
      documentId: true,
      dataroomId: true,
      link: { select: { name: true, slug: true } },
      document: { select: { name: true } },
      dataroom: { select: { name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  await prisma.restrictedToken.update({
    where: { id: tokenRecord.id },
    data: { lastUsed: new Date() },
  });

  return res.status(200).json({
    views: page.map(serializeView),
    // Unchanged cursor when the page is empty, so callers can always persist it.
    nextCursor: last
      ? encodeCursor({ viewedAt: last.viewedAt, id: last.id })
      : ((cursor && encodeCursor(cursor)) ?? null),
    hasMore,
    settledBefore: settledBefore.toISOString(),
    generatedAt: new Date().toISOString(),
  });
}
