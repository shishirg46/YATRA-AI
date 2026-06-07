export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function patchDestinationHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.destination.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Destination not found." }, { status: 404 });
    }

    const {
      name,
      district,
      province,
      municipality,
      latitude,
      longitude,
      altitude,
      category,
      description,
      image,
      tags,
      verified,
      routeAccessible,
    } = body;

    const newName = name !== undefined ? name.trim() : existing.name;
    const newDistrict = district !== undefined ? district.trim() : existing.district;
    const newProvince = province !== undefined ? province.trim() : existing.province;

    // Check unique constraint if identity changes
    if (
      newName !== existing.name ||
      newDistrict !== existing.district ||
      newProvince !== existing.province
    ) {
      const duplicate = await prisma.destination.findFirst({
        where: {
          name: newName,
          district: newDistrict,
          province: newProvince,
          id: { not: id },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { message: `Destination '${newName}' already exists in ${newDistrict}, ${newProvince}.` },
          { status: 409 }
        );
      }
    }

    const normalizedName = name !== undefined
      ? name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
      : undefined;

    // Determine verification changes
    let verifiedBy = undefined;
    let verifiedAt = undefined;
    if (verified !== undefined && verified !== existing.verified) {
      if (verified) {
        verifiedBy = admin.id;
        verifiedAt = new Date();
      } else {
        verifiedBy = null;
        verifiedAt = null;
      }
    }

    // Recompute dataQualityScore
    let score = 75;
    const currentDesc = description !== undefined ? description : existing.description;
    const currentImg = image !== undefined ? image : existing.image;
    const currentTags = tags !== undefined ? tags : existing.tags;

    if (currentDesc) score += 10;
    if (currentImg) score += 10;
    if (currentTags && currentTags.length > 0) score += 5;
    const dataQualityScore = score;

    const updated = await prisma.destination.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: newName, normalizedName }),
        ...(district !== undefined && { district: newDistrict }),
        ...(province !== undefined && { province: newProvince }),
        ...(municipality !== undefined && { municipality: municipality ? municipality.trim() : null }),
        ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
        ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
        ...(altitude !== undefined && { altitude: altitude ? parseFloat(altitude) : null }),
        ...(category !== undefined && { category }),
        ...(description !== undefined && { description: description || null }),
        ...(image !== undefined && { image: image || null }),
        ...(tags !== undefined && { tags }),
        ...(verified !== undefined && { verified, verifiedBy, verifiedAt }),
        ...(routeAccessible !== undefined && { routeAccessible }),
        dataQualityScore,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "UPDATE_DESTINATION",
        entity: "Destination",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

async function deleteDestinationHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;

    const existing = await prisma.destination.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Destination not found." }, { status: 404 });
    }

    await prisma.destination.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "DELETE_DESTINATION",
        entity: "Destination",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

export const PATCH = withRateLimit(patchDestinationHandler, { max: 30, windowSeconds: 60 });
export const DELETE = withRateLimit(deleteDestinationHandler, { max: 30, windowSeconds: 60 });
