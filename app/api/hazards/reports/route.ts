export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

type CreateReportBody = {
  hazardType: string;
  severity: string;
  title: string;
  description?: string;
  lat: number;
  lng: number;
  imageUrl?: string;
};

async function createHazardReportHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as CreateReportBody;

  if (!body.hazardType || !body.severity || !body.title || body.lat === undefined || body.lng === undefined) {
    return NextResponse.json({ message: "hazardType, severity, title, lat, and lng are required." }, { status: 400 });
  }

  const validTypes = ["ROAD_BLOCKAGE", "FLOOD", "LANDSLIDE", "EARTHQUAKE", "FIRE", "STORM", "WILDFIRE", "ACCIDENT", "OTHER"];
  const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  if (!validTypes.includes(body.hazardType)) {
    return NextResponse.json({ message: `Invalid hazardType. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
  }
  if (!validSeverities.includes(body.severity)) {
    return NextResponse.json({ message: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` }, { status: 400 });
  }

  try {
    const report = await prisma.communityHazardReport.create({
      data: {
        userId: session.user.id,
        hazardType: body.hazardType as any,
        severity: body.severity as any,
        title: body.title,
        description: body.description ?? null,
        lat: body.lat,
        lng: body.lng,
        imageUrl: body.imageUrl ?? null,
      },
      select: {
        id: true,
        hazardType: true,
        severity: true,
        title: true,
        description: true,
        lat: true,
        lng: true,
        imageUrl: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error("[hazards/reports/post]", err);
    return NextResponse.json({ message: "Failed to submit report." }, { status: 500 });
  }
}

async function getHazardReportsHandler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radiusKm = parseFloat(searchParams.get("radius") || "50");
  const hazardType = searchParams.get("type");
  const severity = searchParams.get("severity");

  const where: any = { status: "APPROVED" };

  if (hazardType) where.hazardType = hazardType;
  if (severity) where.severity = severity;

  let reports;
  if (lat && lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const degLat = radiusKm / 111.32;
    const degLng = radiusKm / (111.32 * Math.cos((latNum * Math.PI) / 180));

    where.lat = { gte: latNum - degLat, lte: latNum + degLat };
    where.lng = { gte: lngNum - degLng, lte: lngNum + degLng };
  }

  try {
    reports = await prisma.communityHazardReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        hazardType: true,
        severity: true,
        title: true,
        description: true,
        lat: true,
        lng: true,
        imageUrl: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    return NextResponse.json(reports);
  } catch (err) {
    console.error("[hazards/reports/get]", err);
    return NextResponse.json({ message: "Failed to fetch reports." }, { status: 500 });
  }
}

export const POST = withRateLimit(createHazardReportHandler, { max: 10, windowSeconds: 60 });
export const GET = withRateLimit(getHazardReportsHandler, { max: 30, windowSeconds: 60 });
