export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const privacy = await prisma.userPrivacy.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json(
    privacy ?? {
      whoCanSeeName: "everyone",
      whoCanSeeUsername: "everyone",
      whoCanSeeLocation: "everyone",
      whoCanSeeEmail: "nobody",
      whoCanSeeTrips: "everyone",
      whoCanSeePhotos: "everyone",
    }
  );
}

async function patchHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const allowed = [
    "whoCanSeeName", "whoCanSeeUsername", "whoCanSeeLocation",
    "whoCanSeeEmail", "whoCanSeeTrips", "whoCanSeePhotos",
  ];
  const validValues = ["everyone", "friends_only", "nobody"];

  const data: Record<string, string> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (!validValues.includes(body[key])) {
        return NextResponse.json(
          { message: `Invalid value for ${key}. Must be one of: ${validValues.join(", ")}` },
          { status: 400 }
        );
      }
      data[key] = body[key];
    }
  }

  const privacy = await prisma.userPrivacy.upsert({
    where: { userId: session.user.id },
    update: data,
    create: { userId: session.user.id, ...data },
  });

  return NextResponse.json(privacy);
}

export const GET = withRateLimit(getHandler, { max: 30, windowSeconds: 60 });
export const PATCH = withRateLimit(patchHandler, { max: 10, windowSeconds: 60 });
