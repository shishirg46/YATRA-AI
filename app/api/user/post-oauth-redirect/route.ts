export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

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
        select: { id: true, role: true, createdAt: true },
      }),
      prisma.userPreference.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      }),
    ]);

    const cookieStore = await cookies();
    const isSigningUp = cookieStore.get("is_signing_up")?.value === "true";

    // New user check: has the signing up cookie OR account created in the last 15 minutes
    const isRecent = user?.createdAt ? (Date.now() - new Date(user.createdAt).getTime() < 15 * 60 * 1000) : false;
    const isNewUser = isSigningUp || isRecent;

    let dest = "/dashboard";

    if (user?.role === "ADMIN") {
      dest = "/admin/dashboard";
    } else if (user?.role === "ANALYST") {
      dest = "/admin/analytics";
    } else if (!user) {
      dest = "/sign-in";
    } else {
      const hasProfile = !!(user && userPref) || !isNewUser;
      dest = hasProfile ? "/dashboard" : "/onboarding";
    }

    return NextResponse.redirect(new URL(dest, baseUrl), { status: 302 });
  } catch (err) {
    console.error("[post-oauth-redirect]", err);
    return NextResponse.redirect(new URL("/sign-in", baseUrl), { status: 302 });
  }
}
