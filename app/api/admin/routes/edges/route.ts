export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export async function GET(req: NextRequest) {
  try {
    await verifyAdmin();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { roadName: { contains: search, mode: "insensitive" } },
        { fromNode: { name: { contains: search, mode: "insensitive" } } },
        { toNode: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [edges, total] = await Promise.all([
      prisma.routeEdge.findMany({
        where,
        include: {
          fromNode: { select: { name: true, latitude: true, longitude: true } },
          toNode: { select: { name: true, latitude: true, longitude: true } },
        },
        orderBy: { roadName: "asc" },
        skip,
        take: limit,
      }),
      prisma.routeEdge.count({ where }),
    ]);

    return NextResponse.json({
      edges,
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

export async function POST(req: NextRequest) {
  try {
    const admin = await verifyAdmin();
    const body = await req.json();

    const { fromNodeId, toNodeId, distanceKm, roadName, isBidirectional = true } = body;

    if (!fromNodeId || !toNodeId) {
      return NextResponse.json({ message: "Missing fromNodeId or toNodeId." }, { status: 400 });
    }

    // Check if edge already exists
    const duplicate = await prisma.routeEdge.findFirst({
      where: {
        OR: [
          { fromNodeId, toNodeId },
          isBidirectional ? { fromNodeId: toNodeId, toNodeId: fromNodeId } : {},
        ].filter(Boolean) as any,
      },
    });

    if (duplicate) {
      return NextResponse.json({ message: "An edge connecting these nodes already exists." }, { status: 409 });
    }

    let finalDistance = distanceKm ? parseFloat(distanceKm) : 0;
    
    // Auto-calculate distance if not provided
    if (!finalDistance) {
      const [fromNode, toNode] = await Promise.all([
        prisma.routeNode.findUnique({ where: { id: fromNodeId } }),
        prisma.routeNode.findUnique({ where: { id: toNodeId } }),
      ]);
      if (fromNode && toNode) {
        finalDistance = getHaversineDistance(fromNode.latitude, fromNode.longitude, toNode.latitude, toNode.longitude);
      }
    }

    const edge = await prisma.routeEdge.create({
      data: {
        fromNodeId,
        toNodeId,
        distanceKm: finalDistance,
        roadName: roadName || null,
        isBidirectional,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CREATE_ROUTE_EDGE",
        entity: "RouteEdge",
        entityId: edge.id,
      },
    });

    return NextResponse.json(edge);
  } catch (err) {
    return handleAdminError(err);
  }
}
