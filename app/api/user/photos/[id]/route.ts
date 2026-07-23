export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary";
import { withRateLimit } from "@/lib/rate-limit";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure:     true,
});

function extractPublicId(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/");
    const uploadIdx = segments.indexOf("upload");
    if (uploadIdx === -1 || uploadIdx + 1 >= segments.length) return null;
    const versionOrTransform = segments[uploadIdx + 1];
    const startIdx = versionOrTransform.startsWith("v") ? uploadIdx + 2 : uploadIdx + 1;
    const parts = segments.slice(startIdx);
    if (parts.length === 0) return null;
    const last = parts[parts.length - 1];
    const dot = last.lastIndexOf(".");
    if (dot !== -1) parts[parts.length - 1] = last.slice(0, dot);
    return parts.join("/");
  } catch {
    return null;
  }
}

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const photo = await prisma.tripPhoto.findUnique({ where: { id } });
  if (!photo) {
    return NextResponse.json({ message: "Photo not found." }, { status: 404 });
  }
  if (photo.userId !== session.user.id) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const publicId = extractPublicId(photo.imageUrl);
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      console.error("[photos/delete] Cloudinary destroy error:", err);
    }
  }

  await prisma.tripPhoto.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}

export const DELETE = withRateLimit(deleteHandler, { max: 20, windowSeconds: 60 });
