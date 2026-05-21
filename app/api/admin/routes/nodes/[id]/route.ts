export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.routeNode.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Route node not found." }, { status: 404 });
    }

    const { name, type, latitude, longitude, placeId, isHub, isActive } = body;

    const updated = await prisma.routeNode.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
        ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
        ...(placeId !== undefined && { placeId: placeId || null }),
        ...(isHub !== undefined && { isHub }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "UPDATE_ROUTE_NODE",
        entity: "RouteNode",
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

    const existing = await prisma.routeNode.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Route node not found." }, { status: 404 });
    }

    await prisma.routeNode.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "DELETE_ROUTE_NODE",
        entity: "RouteNode",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}
