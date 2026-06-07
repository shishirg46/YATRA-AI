export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLatestLocation, subscribe, type LocationPoint } from "@/lib/location/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareLink: string }> },
) {
  const { shareLink } = await params;

  const session_ = await prisma.locationShareSession.findUnique({
    where: { shareLink },
    select: { isActive: true, expiresAt: true },
  });

  if (!session_ || !session_.isActive) {
    return new Response("Not found or inactive", { status: 404 });
  }

  if (session_.expiresAt && new Date() > session_.expiresAt) {
    return new Response("Expired", { status: 410 });
  }

  // Send the latest known position immediately on connect
  const initial = getLatestLocation(shareLink);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;

      const safeEnqueue = (data: string) => {
        try { if (!aborted) controller.enqueue(encoder.encode(data)); } catch { /* stream closed */ }
      };

      // Send initial position
      if (initial) {
        safeEnqueue(`data: ${JSON.stringify(initial)}\n\n`);
      }

      // Subscribe to live updates
      const unsub = subscribe(shareLink, (point: LocationPoint) => {
        safeEnqueue(`data: ${JSON.stringify(point)}\n\n`);
      });

      // Keepalive ping every 15 seconds
      const keepalive = setInterval(() => {
        safeEnqueue(":keepalive\n\n");
      }, 15_000);

      // Handle client disconnect
      _req.signal.addEventListener("abort", () => {
        aborted = true;
        unsub();
        clearInterval(keepalive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
