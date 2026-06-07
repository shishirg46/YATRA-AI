export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

type CreateContactBody = {
  name: string;
  phone: string;
  email?: string;
  relation?: string;
  isPrimary?: boolean;
};

async function getEmergencyContactsHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const contacts = await prisma.emergencyContact.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      relation: true,
      isPrimary: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(contacts);
}

async function createEmergencyContactHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as CreateContactBody;

  if (!body.name || !body.phone) {
    return NextResponse.json({ message: "name and phone are required." }, { status: 400 });
  }

  try {
    const contact = await prisma.emergencyContact.create({
      data: {
        userId:   session.user.id,
        name:     body.name,
        phone:    body.phone,
        email:    body.email ?? null,
        relation: body.relation ?? null,
        isPrimary: body.isPrimary ?? false,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        relation: true,
        isPrimary: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    console.error("[emergency-contacts/post]", err);
    return NextResponse.json({ message: "Failed to create emergency contact." }, { status: 500 });
  }
}

export const GET = withRateLimit(getEmergencyContactsHandler, { max: 30, windowSeconds: 60 });
export const POST = withRateLimit(createEmergencyContactHandler, { max: 10, windowSeconds: 60 });
