export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPointInNepal } from "@/lib/routing/geo";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function onboardingHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const {
      username,
      province,
      district,
      locationLat,
      locationLng,
      interests,
      riskTolerance,
      travelStyle,
      maxDistanceKm,
      typicalDurationDays,
    } = await req.json();

    if (!province || !district)
      return NextResponse.json({ message: "Province and district are required." }, { status: 400 });
    if (!interests?.length)
      return NextResponse.json({ message: "Select at least one interest." }, { status: 400 });
    if (!riskTolerance)
      return NextResponse.json({ message: "Risk tolerance is required." }, { status: 400 });
    if (!travelStyle?.length)
      return NextResponse.json({ message: "Travel style is required." }, { status: 400 });

    if (locationLat !== undefined && locationLng !== undefined && (locationLat !== 0 || locationLng !== 0)) {
      if (!isPointInNepal(locationLat, locationLng)) {
        return NextResponse.json({ message: "Location must be within Nepal. This service is only available for Nepal." }, { status: 400 });
      }
    }

    // Validate + save username for Google OAuth users
    if (username) {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return NextResponse.json({ message: "Invalid username format." }, { status: 400 });
      }
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ message: "Username already taken." }, { status: 400 });
      }
    }

    // Set up location (we keep this logic as it associates User with HomeLocation)
    const provinceRecord = await prisma.province.upsert({
      where:  { name: province },
      create: { name: province },
      update: {},
    });

    const districtRecord = await prisma.district.upsert({
      where:  { name_provinceId: { name: district, provinceId: provinceRecord.id } },
      create: { name: district, provinceId: provinceRecord.id },
      update: {},
    });

    const location = await prisma.location.upsert({
      where:  { name_districtId: { name: district, districtId: districtRecord.id } },
      create: { name: district, districtId: districtRecord.id, latitude: locationLat || 0, longitude: locationLng || 0 },
      update: {
        latitude: locationLat || 0,
        longitude: locationLng || 0,
      },
    });

    // Update user record
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        homeLocationId: location.id,
        // Only update username if provided (Google OAuth users)
        ...(username ? { username, displayUsername: username } : {}),
      },
    });

    // Upsert UserPreference
    await prisma.userPreference.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        locationLat,
        locationLng,
        interests,
        riskTolerance,
        travelStyle,
        maxDistanceKm,
        typicalDurationDays,
      },
      update: {
        locationLat,
        locationLng,
        interests,
        riskTolerance,
        travelStyle,
        maxDistanceKm,
        typicalDurationDays,
      },
    });

    // Initialize UserBehavior if it doesn't exist
    await prisma.userBehavior.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        metrics: {},
      },
      update: {}, // don't override existing behavior
    });

    // Clean up old profile notification hack if any
    await prisma.notification.deleteMany({
      where: {
        userId:  session.user.id,
        message: { contains: '"_type":"PROFILE"' },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[onboarding]", err);
    return NextResponse.json({ message: "Failed to save profile." }, { status: 500 });
  }
}

export const POST = withRateLimit(onboardingHandler, { max: 10, windowSeconds: 60 });
