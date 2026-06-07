export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function mergeDestinationsHandler(req: NextRequest) {
  try {
    const admin = await verifyAdmin();
    const body = await req.json();

    const { primaryId, duplicateId } = body;

    if (!primaryId || !duplicateId) {
      return NextResponse.json({ message: "Missing primaryId or duplicateId." }, { status: 400 });
    }
    if (primaryId === duplicateId) {
      return NextResponse.json({ message: "Cannot merge a destination with itself." }, { status: 400 });
    }

    const [primary, duplicate] = await Promise.all([
      prisma.destination.findUnique({ where: { id: primaryId } }),
      prisma.destination.findUnique({ where: { id: duplicateId } }),
    ]);

    if (!primary || !duplicate) {
      return NextResponse.json({ message: "One or both destinations not found." }, { status: 404 });
    }

    // Merge logic
    const mergedDescription = primary.description || duplicate.description;
    const mergedImage = primary.image || duplicate.image;
    const mergedAltitude = primary.altitude || duplicate.altitude;
    
    // Combine tags uniquely
    const primaryTags = primary.tags || [];
    const duplicateTags = duplicate.tags || [];
    const mergedTags = Array.from(new Set([...primaryTags, ...duplicateTags]));

    // Verification merge
    const mergedVerified = primary.verified || duplicate.verified;
    const mergedVerifiedBy = mergedVerified 
      ? (primary.verified ? primary.verifiedBy : duplicate.verifiedBy) || admin.id 
      : null;
    const mergedVerifiedAt = mergedVerified 
      ? (primary.verified ? primary.verifiedAt : duplicate.verifiedAt) || new Date() 
      : null;

    // Recalculate data quality score
    let score = 75;
    if (mergedDescription) score += 10;
    if (mergedImage) score += 10;
    if (mergedTags.length > 0) score += 5;
    const dataQualityScore = score;

    // Update primary
    const updatedPrimary = await prisma.destination.update({
      where: { id: primaryId },
      data: {
        description: mergedDescription,
        image: mergedImage,
        altitude: mergedAltitude,
        tags: mergedTags,
        verified: mergedVerified,
        verifiedBy: mergedVerifiedBy,
        verifiedAt: mergedVerifiedAt,
        dataQualityScore,
      },
    });

    // Delete duplicate
    await prisma.destination.delete({ where: { id: duplicateId } });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: `MERGE_DESTINATION_DUPLICATE`,
        entity: "Destination",
        entityId: primaryId,
      },
    });

    return NextResponse.json(updatedPrimary);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const POST = withRateLimit(mergeDestinationsHandler, { max: 30, windowSeconds: 60 });
