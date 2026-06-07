export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getUsersHandler(req: NextRequest) {
  try {
    await verifyAdmin();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const isActiveStr = searchParams.get("isActive") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null, // filter out soft-deleted users
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role && ["USER", "ADMIN", "ANALYST"].includes(role)) {
      where.role = role;
    }

    if (isActiveStr) {
      where.isActive = isActiveStr === "true";
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
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

export const GET = withRateLimit(getUsersHandler, { max: 60, windowSeconds: 60 });
