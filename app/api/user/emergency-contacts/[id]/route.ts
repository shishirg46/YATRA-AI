export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function updateEmergencyContactHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await _req.json()) as { name?: string; phone?: string; email?: string | null; relation?: string | null; isPrimary?: boolean };

  const contact = await prisma.emergencyContact.findUnique({ where: { id } });
  if (!contact || contact.userId !== session.user.id) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const updated = await prisma.emergencyContact.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.relation !== undefined && { relation: body.relation }),
      ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary }),
    },
    select: { id: true, name: true, phone: true, email: true, relation: true, isPrimary: true, createdAt: true, updatedAt: true },
  });

  // If setting this as primary, unset others
  if (body.isPrimary) {
    await prisma.emergencyContact.updateMany({
      where: { userId: session.user.id, id: { not: id } },
      data: { isPrimary: false },
    });
  }

  return NextResponse.json(updated);
}

async function deleteEmergencyContactHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const contact = await prisma.emergencyContact.findUnique({ where: { id } });
  if (!contact || contact.userId !== session.user.id) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  await prisma.emergencyContact.delete({ where: { id } });
  return NextResponse.json({ message: "Deleted" });
}

export const PUT = withRateLimit(updateEmergencyContactHandler, { max: 10, windowSeconds: 60 });
export const DELETE = withRateLimit(deleteEmergencyContactHandler, { max: 10, windowSeconds: 60 });
