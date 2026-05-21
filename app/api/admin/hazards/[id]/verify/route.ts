export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;

    const existing = await prisma.hazardData.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Hazard entry not found." }, { status: 404 });
    }

    const parts = (existing.source || "").split("|");
    const type = parts[0] || "MANUAL";
    const img = parts[2] || "";
    const notes = parts[3] || "";

    const sourceString = `${type}|VERIFIED|${img}|${notes}`;

    const updated = await prisma.hazardData.update({
      where: { id },
      data: {
        source: sourceString,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "VERIFY_HAZARD_DATA",
        entity: "HazardData",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}
