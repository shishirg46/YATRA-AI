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
  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.json({ hasProfile: false, authenticated: false }, { status: 401 });
    }

    const [user, userPref] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: session.user.id },
        select: { username: true },
      }),
      prisma.userPreference.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      }),
    ]);

    const hasProfile    = !!userPref;
    const needsUsername = !user?.username;
    return NextResponse.json({ authenticated: true, hasProfile, needsUsername });
  } catch (err) {
    console.error("[profile-status]", err);
    return NextResponse.json({ hasProfile: false, authenticated: false }, { status: 500 });
  }
}
