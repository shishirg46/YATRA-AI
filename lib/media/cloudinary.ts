import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure: true,
});

function uploadBuffer(
  buffer: Buffer,
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

export async function uploadImageFromUrl(
  imageUrl: string,
  destinationId: string,
  index: number = 0
): Promise<{ secure_url: string; public_id: string } | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return await uploadBuffer(buffer, {
      folder: `yatraai/destinations/${destinationId}`,
      public_id: `${index}`,
      resource_type: "image",
      transformation: [{ fetch_format: "auto", quality: "auto", width: 1600, crop: "limit" }],
    });
  } catch {
    return null;
  }
}

export async function uploadImageFromBuffer(
  buffer: Buffer,
  destinationId: string,
  index: number = 0
): Promise<{ secure_url: string; public_id: string }> {
  return uploadBuffer(buffer, {
    folder: `yatraai/destinations/${destinationId}`,
    public_id: `${index}`,
    resource_type: "image",
    transformation: [{ fetch_format: "auto", quality: "auto", width: 1600, crop: "limit" }],
  });
}

export function getCloudinaryUrl(publicId: string, transform?: string): string {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const base = `https://res.cloudinary.com/${cloudName}/image/upload`;
  if (transform) return `${base}/${transform}/${publicId}`;
  return `${base}/${publicId}`;
}
