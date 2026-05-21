export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.routeEdge.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Route edge not found." }, { status: 404 });
    }

    const { distanceKm, roadName, isBidirectional } = body;

    const updated = await prisma.routeEdge.update({
      where: { id },
      data: {
        ...(distanceKm !== undefined && { distanceKm: parseFloat(distanceKm) }),
        ...(roadName !== undefined && { roadName: roadName || null }),
        ...(isBidirectional !== undefined && { isBidirectional }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "UPDATE_ROUTE_EDGE",
        entity: "RouteEdge",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;

    const existing = await prisma.routeEdge.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Route edge not found." }, { status: 404 });
    }

    await prisma.routeEdge.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "DELETE_ROUTE_EDGE",
        entity: "RouteEdge",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}
