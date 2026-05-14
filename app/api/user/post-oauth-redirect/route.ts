export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.redirect(new URL("/sign-in", baseUrl), { status: 302 });
    }

    const [user, userPref] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: session.user.id },
        select: { id: true },
      }),
      prisma.userPreference.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      }),
    ]);

    const hasProfile = !!(user && userPref);
    const dest       = hasProfile ? "/dashboard" : "/onboarding";
    return NextResponse.redirect(new URL(dest, baseUrl), { status: 302 });
  } catch (err) {
    console.error("[post-oauth-redirect]", err);
    return NextResponse.redirect(new URL("/sign-in", baseUrl), { status: 302 });
  }
}
