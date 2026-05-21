import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/sign-in");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (!user) {
    redirect("/sign-in");
  }

  // ADMIN can access all admin pages
  if (user.role === "ADMIN") {
    return <>{children}</>;
  }

  // ANALYST can ONLY access /admin/analytics
  if (user.role === "ANALYST") {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    if (pathname.startsWith("/admin/analytics")) {
      return <>{children}</>;
    }
    redirect("/admin/analytics");
  }

  // USER role — no admin access
  redirect("/dashboard");
}
