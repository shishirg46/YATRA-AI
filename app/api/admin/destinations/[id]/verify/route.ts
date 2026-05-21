/**
 * FILE: route.ts
 * LOCATION: /app/api/admin/destinations/[id]/verify/route.ts
 * PURPOSE: Mark a destination as verified
 */

export const dynamic = "force-dynamic";

import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ message: "Admin access required" }, { status: 403 });
    }

    // Update destination to verified
    const updated = await prisma.destination.update({
      where: { id },
      data: {
        verified: true,
        verifiedAt: new Date(),
        verifiedBy: session.user.id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[admin/destinations/verify]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
