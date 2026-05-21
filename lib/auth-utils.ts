import { auth } from "./auth";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import { redirect } from "next/navigation";

export type Role = "USER" | "ADMIN" | "ANALYST";

export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return session.user;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}

export async function getUserRole(): Promise<Role | null> {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true },
  });

  return (user?.role as Role) ?? null;
}

export async function requireRole(allowedRoles: Role[]) {
  const sessionUser = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, role: true, name: true, email: true, isActive: true },
  });

  if (!user || !allowedRoles.includes(user.role as Role)) {
    redirect("/unauthorized");
  }

  return user;
}

export async function checkRole(allowedRoles: Role[]): Promise<boolean> {
  const role = await getUserRole();
  return role !== null && allowedRoles.includes(role);
}
