import { NextApiRequest, NextApiResponse } from "next";
import { hashToken } from "@/lib/api/auth/token";
import prisma from "@/lib/prisma";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });

  const rawToken = authHeader.slice(7);
  const hashed = await hashToken(rawToken);

  const tokenRecord = await prisma.restrictedToken.findUnique({
    where: { hashedKey: hashed },
    include: { team: true },
  });

  if (!tokenRecord) return res.status(401).json({ error: "Invalid token" });

  await prisma.restrictedToken.update({
    where: { id: tokenRecord.id },
    data: { lastUsedAt: new Date() },
  });

  const teamId = tokenRecord.teamId;

  const [documents, links, datarooms] = await Promise.all([
    prisma.document.findMany({
      where: { link: { teamId } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, name: true, createdAt: true, updatedAt: true,
        _count: { select: { links: true, views: true } },
      },
    }),
    prisma.link.findMany({
      where: { link: { teamId } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, name: true, slug: true, createdAt: true,
        domainSlug: true,
        _count: { select: { views: true } },
      },
    }),
    prisma.dataroom.findMany({
      where: { link: { teamId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, name: true, createdAt: true,
        _count: { select: { links: true } },
      },
    }),
  ]);

  const views = await prisma.view.findMany({
    where: { link: { teamId } },
    orderBy: { viewedAt: "desc" },
    take: 500,
    select: {
      id: true, viewedAt: true, viewerEmail: true, viewerName: true,
      totalDuration: true, completionRate: true,
      linkId: true, documentId: true,
      link: { select: { name: true, slug: true } },
      document: { select: { name: true } },
    },
  });

  // Engagement per viewer
  const viewerMap: Record<string, any> = {};
  for (const v of views) {
    if (!v.viewerEmail) continue;
    const key = v.viewerEmail;
    if (!viewerMap[key]) {
      viewerMap[key] = {
        email: v.viewerEmail, name: v.viewerName ?? undefined,
        views: 0, totalDuration: 0, completionSum: 0,
        lastSeen: v.viewedAt, documents: new Set(), links: new Set(),
      };
    }
    const vm = viewerMap[key];
    vm.views++;
    vm.totalDuration += v.totalDuration ?? 0;
    vm.completionSum += v.completionRate ?? 0;
    if (v.viewedAt > vm.lastSeen) vm.lastSeen = v.viewedAt;
    if (v.documentId) vm.documents.add(v.documentId);
    if (v.linkId) vm.links.add(v.linkId);
  }

  const scoredViewers = Object.values(viewerMap).map((vm: any) => {
    const daysAgo = (Date.now() - new Date(vm.lastSeen).getTime()) / 86400000;
    const avgCompletion = vm.completionSum / vm.views;
    const recencyScore = Math.max(0, 40 - daysAgo * 2);
    const durationScore = Math.min(20, (vm.totalDuration / 60000) * 2);
    const completionScore = (avgCompletion / 100) * 20;
    const depthScore = Math.min(20, (vm.documents.size + vm.links.size) * 4);
    const score = Math.round(recencyScore + durationScore + completionScore + depthScore);
    return {
      email: vm.email, name: vm.name, score,
      classification: score >= 70 ? "HOT" : score >= 40 ? "WARM" : "COLD",
      views: vm.views,
      totalDurationMinutes: Math.round(vm.totalDuration / 60000),
      avgCompletionPct: Math.round(avgCompletion),
      lastSeen: vm.lastSeen,
      daysAgo: Math.round(daysAgo),
      documentsViewed: vm.documents.size,
      linksVisited: vm.links.size,
    };
  }).sort((a: any, b: any) => b.score - a.score);

  const ghosts = scoredViewers.filter((v: any) => v.daysAgo >= 7 && v.views > 0);

  const docPerf = documents.map(doc => {
    const docViews = views.filter(v => v.documentId === doc.id);
    const avgDuration = docViews.length > 0
      ? docViews.reduce((s, v) => s + (v.totalDuration ?? 0), 0) / docViews.length / 60000 : 0;
    const avgCompletion = docViews.length > 0
      ? docViews.reduce((s, v) => s + (v.completionRate ?? 0), 0) / docViews.length : 0;
    return {
      id: doc.id, name: doc.name,
      totalViews: docViews.length,
      uniqueViewers: new Set(docViews.map(v => v.viewerEmail)).size,
      avgDurationMinutes: Math.round(avgDuration * 10) / 10,
      avgCompletionPct: Math.round(avgCompletion),
    };
  }).sort((a, b) => b.totalViews - a.totalViews);

  const now = new Date();
  const weeklyTrend = [3, 2, 1, 0].map(weeksAgo => {
    const start = new Date(now.getTime() - (weeksAgo + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - weeksAgo * 7 * 86400000);
    const wv = views.filter(v => v.viewedAt >= start && v.viewedAt < end);
    return {
      weekLabel: weeksAgo === 0 ? "this-week" : `W-${weeksAgo}`,
      views: wv.length,
      uniqueViewers: new Set(wv.map(v => v.viewerEmail).filter(Boolean)).size,
    };
  });

  return res.status(200).json({
    summary: {
      totalDocuments: documents.length,
      totalLinks: links.length,
      totalDatarooms: datarooms.length,
      totalViews: views.length,
      uniqueViewers: Object.keys(viewerMap).length,
      hotLeads: scoredViewers.filter((v: any) => v.classification === "HOT").length,
      warmLeads: scoredViewers.filter((v: any) => v.classification === "WARM").length,
      coldLeads: scoredViewers.filter((v: any) => v.classification === "COLD").length,
      ghostsCount: ghosts.length,
    },
    viewers: scoredViewers.slice(0, 50),
    ghosts: ghosts.slice(0, 20),
    documentPerformance: docPerf.slice(0, 20),
    weeklyTrend,
    recentViews: views.slice(0, 20).map(v => ({
      viewedAt: v.viewedAt,
      viewerEmail: v.viewerEmail,
      viewerName: v.viewerName,
      document: v.document?.name,
      link: v.link?.name ?? v.link?.slug,
      durationMinutes: Math.round((v.totalDuration ?? 0) / 60000 * 10) / 10,
      completionPct: Math.round(v.completionRate ?? 0),
    })),
    documents,
    datarooms,
    generatedAt: new Date().toISOString(),
  });
}
