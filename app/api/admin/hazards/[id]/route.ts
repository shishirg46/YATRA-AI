export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function patchHazardHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.hazardData.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Hazard entry not found." }, { status: 404 });
    }

    const {
      floodIndex,
      landslideIndex,
      heatIndex,
      airQuality,
      recordedAt,
      image,
      notes,
      verified,
    } = body;

    // Decode existing source
    const parts = (existing.source || "").split("|");
    const existingType = parts[0] || "MANUAL";
    const existingVer = parts[1] || "UNVERIFIED";
    const existingImg = parts[2] || "";
    const existingNotes = parts[3] || "";

    const newVer = verified !== undefined 
      ? (verified ? "VERIFIED" : "UNVERIFIED") 
      : existingVer;
    const newImg = image !== undefined ? image : existingImg;
    const newNotes = notes !== undefined ? notes : existingNotes;

    const sourceString = `${existingType}|${newVer}|${newImg}|${newNotes}`;

    const updated = await prisma.hazardData.update({
      where: { id },
      data: {
        ...(floodIndex !== undefined && { floodIndex: parseFloat(floodIndex) }),
        ...(landslideIndex !== undefined && { landslideIndex: parseFloat(landslideIndex) }),
        ...(heatIndex !== undefined && { heatIndex: parseFloat(heatIndex) }),
        ...(airQuality !== undefined && { airQuality: parseFloat(airQuality) }),
        ...(recordedAt !== undefined && { recordedAt: new Date(recordedAt) }),
        source: sourceString,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "UPDATE_HAZARD",
        entity: "HazardData",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

async function deleteHazardHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;

    const existing = await prisma.hazardData.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Hazard entry not found." }, { status: 404 });
    }

    await prisma.hazardData.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "DELETE_HAZARD",
        entity: "HazardData",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

export const PATCH = withRateLimit(patchHazardHandler, { max: 30, windowSeconds: 60 });
export const DELETE = withRateLimit(deleteHazardHandler, { max: 30, windowSeconds: 60 });
