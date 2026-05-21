export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.json({ hasProfile: false, authenticated: false }, { status: 401 });
    }

    const [user, userPref] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: session.user.id },
        select: { username: true, role: true, createdAt: true },
      }),
      prisma.userPreference.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      }),
    ]);

    const cookieStore = await cookies();
    const isSigningUp = cookieStore.get("is_signing_up")?.value === "true";

    const isAdminOrAnalyst = user?.role === "ADMIN" || user?.role === "ANALYST";
    
    // New user check: has the signing up cookie OR account created in the last 15 minutes
    const isRecent = user?.createdAt ? (Date.now() - new Date(user.createdAt).getTime() < 15 * 60 * 1000) : false;
    const isNewUser = isSigningUp || isRecent;

    const hasProfile    = !!userPref || isAdminOrAnalyst || !isNewUser;
    const needsUsername = !user?.username && !isAdminOrAnalyst && isNewUser;
    return NextResponse.json({ authenticated: true, hasProfile, needsUsername });
  } catch (err) {
    console.error("[profile-status]", err);
    return NextResponse.json({ hasProfile: false, authenticated: false }, { status: 500 });
  }
}
