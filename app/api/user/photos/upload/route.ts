export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { v2 as cloudinary } from "cloudinary";
import { withRateLimit } from "@/lib/rate-limit";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure:     true,
});

function uploadBuffer(
  buffer:  Buffer,
  options: import("cloudinary").UploadApiOptions
): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(options, (error, result) => {
        if (error || !result) return reject(error ?? new Error("No result from Cloudinary"));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      })
      .end(buffer);
  });
}

async function postHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ message: "No file provided." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ message: "File must be an image." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ message: "Image must be under 10 MB." }, { status: 400 });
  }

  const caption = (formData.get("caption") as string) || null;
  const location = (formData.get("location") as string) || null;
  const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
  const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;
  const tripId = (formData.get("tripId") as string) || null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadBuffer(buffer, {
      folder: "yatraai/trip-photos",
      public_id: `${session.user.id}_${Date.now()}`,
      resource_type: "image",
      transformation: [
        { width: 1200, crop: "limit", quality: "auto", fetch_format: "auto" },
      ],
    });

    const { prisma } = await import("@/lib/prisma");
    const photo = await prisma.tripPhoto.create({
      data: {
        userId: session.user.id,
        imageUrl: result.secure_url,
        tripId,
        caption,
        location,
        latitude,
        longitude,
      },
    });

    return NextResponse.json(photo, { status: 201 });
  } catch (err) {
    console.error("[photos/upload] Error:", err);
    return NextResponse.json({ message: "Upload failed." }, { status: 500 });
  }
}

export const POST = withRateLimit(postHandler, { max: 10, windowSeconds: 60 });
