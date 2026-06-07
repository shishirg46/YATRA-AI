export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getRouteNodesHandler(req: NextRequest) {
  try {
    await verifyAdmin();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [nodes, total] = await Promise.all([
      prisma.routeNode.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.routeNode.count({ where }),
    ]);

    return NextResponse.json({
      nodes,
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

async function createRouteNodeHandler(req: NextRequest) {
  try {
    const admin = await verifyAdmin();
    const body = await req.json();

    const { name, type = "ROUTE_NODE", latitude, longitude, placeId, isHub = false, isActive = true } = body;

    if (!name || latitude === undefined || longitude === undefined) {
      return NextResponse.json({ message: "Missing required fields." }, { status: 400 });
    }

    const node = await prisma.routeNode.create({
      data: {
        name,
        type,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        placeId: placeId || null,
        isHub,
        isActive,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CREATE_ROUTE_NODE",
        entity: "RouteNode",
        entityId: node.id,
      },
    });

    return NextResponse.json(node);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withRateLimit(getRouteNodesHandler, { max: 60, windowSeconds: 60 });
export const POST = withRateLimit(createRouteNodeHandler, { max: 30, windowSeconds: 60 });
