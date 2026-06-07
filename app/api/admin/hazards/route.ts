export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getHazardsHandler(req: NextRequest) {
  try {
    await verifyAdmin();

    const { searchParams } = new URL(req.url);
    const district = searchParams.get("district") || "";
    const severity = searchParams.get("severity") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (district) {
      where.location = {
        district: {
          name: { contains: district, mode: "insensitive" },
        },
      };
    }

    // Simulate severity filter using corresponding index levels
    if (severity) {
      if (severity === "EXTREME") {
        where.OR = [
          { floodIndex: { gte: 0.8 } },
          { landslideIndex: { gte: 0.8 } },
        ];
      } else if (severity === "HIGH_RISK") {
        where.OR = [
          { floodIndex: { gte: 0.5, lt: 0.8 } },
          { landslideIndex: { gte: 0.5, lt: 0.8 } },
          { airQuality: { gte: 0.8 } },
        ];
      } else if (severity === "CAUTION") {
        where.OR = [
          { floodIndex: { gte: 0.2, lt: 0.5 } },
          { landslideIndex: { gte: 0.2, lt: 0.5 } },
          { airQuality: { gte: 0.4, lt: 0.8 } },
        ];
      } else if (severity === "SAFE") {
        where.AND = [
          { OR: [{ floodIndex: { lt: 0.2 } }, { floodIndex: null }] },
          { OR: [{ landslideIndex: { lt: 0.2 } }, { landslideIndex: null }] },
          { OR: [{ airQuality: { lt: 0.4 } }, { airQuality: null }] },
        ];
      }
    }

    const [hazards, total] = await Promise.all([
      prisma.hazardData.findMany({
        where,
        include: {
          location: {
            select: {
              name: true,
              latitude: true,
              longitude: true,
              district: {
                select: {
                  name: true,
                  province: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { recordedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.hazardData.count({ where }),
    ]);

    return NextResponse.json({
      hazards,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function createHazardHandler(req: NextRequest) {
  try {
    const admin = await verifyAdmin();
    const body = await req.json();

    const {
      locationId,
      floodIndex = 0,
      landslideIndex = 0,
      heatIndex = 0,
      airQuality = 0,
      recordedAt,
      image = "",
      notes = "",
      verified = false,
    } = body;

    if (!locationId || !recordedAt) {
      return NextResponse.json({ message: "Missing locationId or recordedAt." }, { status: 400 });
    }

    // Encode verified, image, and notes inside source string
    const sourceString = `MANUAL|${verified ? "VERIFIED" : "UNVERIFIED"}|${image}|${notes}`;

    const hazard = await prisma.hazardData.create({
      data: {
        locationId,
        floodIndex: parseFloat(floodIndex),
        landslideIndex: parseFloat(landslideIndex),
        heatIndex: parseFloat(heatIndex),
        airQuality: parseFloat(airQuality),
        recordedAt: new Date(recordedAt),
        source: sourceString,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CREATE_HAZARD",
        entity: "HazardData",
        entityId: hazard.id,
      },
    });

    return NextResponse.json(hazard);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withRateLimit(getHazardsHandler, { max: 60, windowSeconds: 60 });
export const POST = withRateLimit(createHazardHandler, { max: 30, windowSeconds: 60 });
