export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function moderateReportHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();
    const { status, rejectionReason } = body;

    if (!status || !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return NextResponse.json({ message: "status must be PENDING, APPROVED, or REJECTED." }, { status: 400 });
    }

    const existing = await prisma.communityHazardReport.findUnique({
      where: { id },
      select: { userId: true, title: true, hazardType: true, locationId: true, lat: true, lng: true },
    });
    if (!existing) {
      return NextResponse.json({ message: "Report not found." }, { status: 404 });
    }

    const updated = await prisma.communityHazardReport.update({
      where: { id },
      data: {
        status,
        moderatedBy: admin.id,
        moderatedAt: new Date(),
        ...(status === "REJECTED" ? { rejectionReason: rejectionReason ?? null } : { rejectionReason: null }),
      },
      select: {
        id: true,
        hazardType: true,
        severity: true,
        title: true,
        status: true,
        rejectionReason: true,
        moderatedAt: true,
        moderator: { select: { name: true } },
      },
    });

    // Notify the reporter
    if (status === "APPROVED" || status === "REJECTED") {
      const notifMsg = status === "APPROVED"
        ? JSON.stringify({ _type: "HAZARD", title: "Report Approved", body: `Your "${existing.title}" hazard report was approved and is now visible to travelers.` })
        : JSON.stringify({ _type: "HAZARD", title: "Report Rejected", body: `Your "${existing.title}" hazard report was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}` });

      await prisma.notification.create({
        data: { userId: existing.userId, message: notifMsg },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: status === "APPROVED" ? "APPROVE_REPORT" : status === "REJECTED" ? "REJECT_REPORT" : "PENDING_REPORT",
        entity: "CommunityHazardReport",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const PATCH = withRateLimit(moderateReportHandler, { max: 30, windowSeconds: 60 });
