export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@/app/generated/prisma/enums"; // adjust to your actual generated path

// Define which roles can be assigned/deleted by which admin tiers
const ROLE_HIERARCHY: Record<string, number> = {
  USER: 1,
  ANALYST: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

function canManage(actorRole: string, targetRole: string): boolean {
  return (ROLE_HIERARCHY[actorRole] ?? 0) > (ROLE_HIERARCHY[targetRole] ?? 0);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await verifyAdmin();
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        health: true,
        preference: true,
        behavior: true,
        travelPlans: {
          select: {
            id: true,
            title: true,
            tripType: true,
            status: true,
            startDate: true,
            endDate: true,
            budgetNPR: true,
            createdAt: true,
            _count: { select: { stops: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user || user.deletedAt) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;
    const body = await req.json();

    const { name, username, role, isActive } = body;

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser || existingUser.deletedAt) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    // ✅ Guard: admin cannot edit users of equal or higher rank
    if (!canManage(admin.role, existingUser.role)) {
      return NextResponse.json(
        { message: `You do not have permission to edit a ${existingUser.role}.` },
        { status: 403 }
      );
    }

    // ✅ Guard: admin cannot assign a role equal to or higher than their own
    if (role !== undefined && !canManage(admin.role, role)) {
      return NextResponse.json(
        { message: `You cannot assign the role ${role}.` },
        { status: 403 }
      );
    }

    // ✅ Guard: validate role is a known enum value
    if (role !== undefined && !(role in ROLE_HIERARCHY)) {
      return NextResponse.json(
        { message: `Invalid role: ${role}.` },
        { status: 400 }
      );
    }

    // Check username uniqueness if modified
    if (username && username !== existingUser.username) {
      const clean = username.trim().toLowerCase().replace(/^@/, "");
      const duplicate = await prisma.user.findFirst({
        where: { username: clean, id: { not: id } },
      });
      if (duplicate) {
        return NextResponse.json({ message: "Username is already taken." }, { status: 409 });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(username !== undefined && {
          username: username.trim().toLowerCase().replace(/^@/, ""),
          displayUsername: username.trim().replace(/^@/, ""),
        }),
        ...(role !== undefined && { role: role as Role }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    const changes: string[] = [];
    if (name !== undefined && name !== existingUser.name) changes.push("name");
    if (username !== undefined && username !== existingUser.username) changes.push("username");
    if (role !== undefined && role !== existingUser.role) changes.push("role");
    if (isActive !== undefined && isActive !== existingUser.isActive) changes.push("isActive");

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: `EDIT_USER_${changes.join("_").toUpperCase() || "FIELDS"}`,
        entity: "User",
        entityId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    const { id } = await params;

    // ✅ Prevent self-deletion
    if (admin.id === id) {
      return NextResponse.json({ message: "You cannot delete your own account." }, { status: 403 });
    }

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser || existingUser.deletedAt) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    // ✅ Guard: admin cannot delete users of equal or higher rank
    if (!canManage(admin.role, existingUser.role)) {
      return NextResponse.json(
        { message: `You do not have permission to delete a ${existingUser.role}.` },
        { status: 403 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "SOFT_DELETE_USER",
        entity: "User",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}