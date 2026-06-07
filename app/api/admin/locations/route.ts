export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getLocationsHandler(req: NextRequest) {
  try {
    await verifyAdmin();
    const locations = await prisma.location.findMany({
      select: {
        id: true,
        name: true,
        district: {
          select: {
            name: true,
            province: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const formatted = locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      district: loc.district.name,
      province: loc.district.province.name,
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withRateLimit(getLocationsHandler, { max: 60, windowSeconds: 60 });
