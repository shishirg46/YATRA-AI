export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    await verifyAdmin();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const category = searchParams.get("category") || "";
    const verifiedStr = searchParams.get("verified") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
        { province: { contains: search, mode: "insensitive" } },
      ];
    }

    if (category) {
      where.category = category;
    }

    if (verifiedStr) {
      where.verified = verifiedStr === "true";
    }

    const [destinations, total] = await Promise.all([
      prisma.destination.findMany({
        where,
        orderBy: [{ verified: "asc" }, { dataQualityScore: "desc" }],
        skip,
        take: limit,
      }),
      prisma.destination.count({ where }),
    ]);

    return NextResponse.json({
      destinations,
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

    const {
      name,
      district,
      province,
      municipality,
      latitude,
      longitude,
      altitude,
      category,
      description,
      image,
      tags = [],
    } = body;

    if (!name || !district || !province || latitude === undefined || longitude === undefined || !category) {
      return NextResponse.json({ message: "Missing required fields." }, { status: 400 });
    }

    // Normalize name
    const normalizedName = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    // Check unique constraint: @@unique([name, district, province])
    const existing = await prisma.destination.findUnique({
      where: {
        name_district_province: {
          name: name.trim(),
          district: district.trim(),
          province: province.trim(),
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { message: `Destination '${name}' already exists in ${district}, ${province}.` },
        { status: 409 }
      );
    }

    // Compute simple quality score: baseline 75 + points for extra info
    let dataQualityScore = 75;
    if (description) dataQualityScore += 10;
    if (image) dataQualityScore += 10;
    if (tags.length > 0) dataQualityScore += 5;

    const destination = await prisma.destination.create({
      data: {
        name: name.trim(),
        normalizedName,
        district: district.trim(),
        province: province.trim(),
        municipality: municipality ? municipality.trim() : null,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        altitude: altitude ? parseFloat(altitude) : null,
        category,
        description: description || null,
        image: image || null,
        tags,
        source: "MANUAL",
        verified: true, // manuals created by admins are verified by default
        verifiedBy: admin.id,
        verifiedAt: new Date(),
        coordinateAccuracy: 5.0, // manually placed coordinates are highly accurate
        dataQualityScore,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CREATE_DESTINATION",
        entity: "Destination",
        entityId: destination.id,
      },
    });

    return NextResponse.json(destination);
  } catch (err) {
    return handleAdminError(err);
  }
}
