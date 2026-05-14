export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { category, action, destinationId } = await req.json();

    if (!category && !destinationId) {
      return NextResponse.json({ message: "Category or destinationId required" }, { status: 400 });
    }

    // Get current behavior
    let behavior = await prisma.userBehavior.findUnique({
      where: { userId: session.user.id },
    });

    if (!behavior) {
      behavior = await prisma.userBehavior.create({
        data: {
          userId: session.user.id,
          metrics: {},
        },
      });
    }

    const metrics = (behavior.metrics as Record<string, any>) || {};
    
    // Initialize structures if not present
    if (!metrics.categories) metrics.categories = {};
    if (!metrics.destinations) metrics.destinations = {};

    // Increment category clicks
    if (category) {
      metrics.categories[category] = (metrics.categories[category] || 0) + 1;
    }

    // Increment destination clicks
    if (destinationId) {
      metrics.destinations[destinationId] = (metrics.destinations[destinationId] || 0) + 1;
    }

    // Update behavior
    await prisma.userBehavior.update({
      where: { userId: session.user.id },
      data: { metrics },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[behavior]", err);
    return NextResponse.json({ message: "Failed to update behavior." }, { status: 500 });
  }
}
