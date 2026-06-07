/**
 * FILE: route.ts
 * LOCATION: /app/api/user/avatar/route.ts
 * PURPOSE: Uploads profile photo to Cloudinary, saves URL to DB
 *
 * SETUP — do these 3 things before this route works:
 *
 *   1. Install the package:
 *        npm install cloudinary
 *
 *   2. Add to .env.local:
 *        CLOUDINARY_CLOUD_NAME=your_cloud_name
 *        CLOUDINARY_API_KEY=your_api_key
 *        CLOUDINARY_API_SECRET=your_api_secret
 *
 *   3. Add to next.config.ts so next/image can load Cloudinary URLs:
 *        const nextConfig = {
 *          images: {
 *            remotePatterns: [
 *              { protocol: "https", hostname: "res.cloudinary.com" },
 *            ],
 *          },
 *        };
 *        export default nextConfig;
 *
 * FLOW:
 *   POST /api/user/avatar (multipart, field: "avatar")
 *   → validate MIME type + file size (max 5 MB)
 *   → stream buffer to Cloudinary
 *   → apply transforms: 400×400 face-crop, auto format/quality
 *   → save secure_url → user.image in DB
 *   → return { url: string }
 *
 * RE-UPLOADS:
 *   public_id is set to the user's ID, so every upload overwrites the previous
 *   avatar on Cloudinary — no orphaned files accumulate.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary";
import { withRateLimit } from "@/lib/rate-limit";

// Configure Cloudinary once at module load — reads from .env.local
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure:     true, // always return https:// URLs
});

/**
 * Wraps Cloudinary's callback-based upload_stream in a Promise.
 *
 * We use UploadApiOptions explicitly instead of Parameters<typeof upload_stream>[0]
 * because upload_stream has multiple overloads — TypeScript can pick the wrong one
 * (the single-arg callback overload) and then reject "folder", "public_id", etc.
 * Typing the options param as UploadApiOptions forces the correct overload.
 */
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

async function uploadAvatarHandler(req: NextRequest) {
  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse multipart form ──────────────────────────────────────────────────
  const formData = await req.formData();
  const file     = formData.get("avatar") as File | null;

  if (!file) {
    return NextResponse.json({ message: "No file provided." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ message: "File must be an image (JPEG, PNG, WebP, etc.)." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ message: "Image must be under 5 MB." }, { status: 400 });
  }

  try {
    // ── 3. Read file into a Buffer ─────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());

    // ── 4. Upload to Cloudinary ────────────────────────────────────────────────
    // public_id = userId → every upload overwrites the same asset, no orphans
    // Transformation chain:
    //   c_fill + g_face  → smart square crop centered on the person's face
    //   f_auto           → serve WebP / AVIF to supporting browsers automatically
    //   q_auto           → Cloudinary picks the optimal compression level
    const result = await uploadBuffer(buffer, {
      folder:        "yatraai/avatars",
      public_id:     session.user.id,
      overwrite:     true,
      resource_type: "image",
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { fetch_format: "auto", quality: "auto" },
      ],
    });

    // ── 5. Persist URL ─────────────────────────────────────────────────────────
    await prisma.user.update({
      where: { id: session.user.id },
      data:  { image: result.secure_url },
    });

    return NextResponse.json({ url: result.secure_url });

  } catch (err) {
    console.error("[avatar/upload] Error:", err);
    return NextResponse.json(
      { message: "Upload failed. Check your Cloudinary credentials in .env.local." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(uploadAvatarHandler, { max: 10, windowSeconds: 60 });
