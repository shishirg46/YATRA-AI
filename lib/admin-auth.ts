import { auth } from "./auth";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";

export type AllowedRole = "USER" | "ADMIN" | "ANALYST";

export async function verifyAdmin() {
  return verifyRole(["ADMIN"]);
}

export async function verifyRole(allowedRoles: AllowedRole[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, name: true, email: true },
  });

  if (!user || !allowedRoles.includes(user.role as AllowedRole)) {
    throw new Error("Forbidden");
  }

  return user;
}

export function handleAdminError(err: unknown) {
  if (err instanceof Error) {
    if (err.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (err.message === "Forbidden") {
      return NextResponse.json({ message: "Access denied" }, { status: 403 });
    }
  }
  console.error("[admin-auth-error]", err);
  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}
