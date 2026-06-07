export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));

  const [photos, total] = await Promise.all([
    prisma.tripPhoto.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tripPhoto.count({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ photos, total, page, limit });
}

async function postHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  if (!body.imageUrl) {
    return NextResponse.json({ message: "imageUrl is required." }, { status: 400 });
  }

  const photo = await prisma.tripPhoto.create({
    data: {
      userId: session.user.id,
      imageUrl: body.imageUrl,
      tripId: body.tripId ?? null,
      caption: body.caption ?? null,
      location: body.location ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    },
  });

  return NextResponse.json(photo, { status: 201 });
}

export const GET = withRateLimit(getHandler, { max: 30, windowSeconds: 60 });
export const POST = withRateLimit(postHandler, { max: 20, windowSeconds: 60 });
