import { prisma } from "@/lib/prisma";
import { findDestinationPhotos } from "@/lib/media/photo-sources";
import { uploadImageFromUrl } from "@/lib/media/cloudinary";

export interface CachedPhoto {
  url: string;
  thumbUrl?: string | null;
  title?: string | null;
  sourceUrl: string;
  index: number;
}

export async function getDestinationPhotos(
  destinationId: string,
  name: string,
  lat: number,
  lon: number,
): Promise<CachedPhoto[]> {
  // 1. Check DB for cached photos
  const cached = await prisma.destinationPhoto.findMany({
    where: { destinationId },
    orderBy: { index: "asc" },
  });

  if (cached.length > 0) {
    return cached.map((p) => ({
      url: p.cloudinaryUrl,
      thumbUrl: p.thumbUrl,
      title: p.title,
      sourceUrl: p.sourceUrl,
      index: p.index,
    }));
  }

  // 2. No cache — fetch from Wikipedia + Commons
  const photos = await findDestinationPhotos(name, lat, lon);
  if (photos.length === 0) return [];

  // 3. Upload each to Cloudinary and store in DB
  const results: CachedPhoto[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const uploaded = await uploadImageFromUrl(photo.url, destinationId, i);
    if (!uploaded) continue;

    try {
      await prisma.destinationPhoto.create({
        data: {
          destinationId,
          cloudinaryUrl: uploaded.secure_url,
          sourceUrl: photo.source === "wikipedia"
            ? `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`
            : photo.url,
          thumbUrl: photo.thumbUrl,
          title: photo.title,
          index: i,
          source: photo.source,
        },
      });
    } catch {
      // Duplicate or race — skip
    }

    results.push({
      url: uploaded.secure_url,
      thumbUrl: photo.thumbUrl,
      title: photo.title,
      sourceUrl: photo.source === "wikipedia"
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`
        : photo.url,
      index: i,
    });
  }

  // Also update the main image field if empty
  if (results.length > 0) {
    const dest = await prisma.destination.findUnique({
      where: { id: destinationId },
      select: { image: true },
    });
    if (!dest?.image) {
      await prisma.destination.update({
        where: { id: destinationId },
        data: { image: results[0].url },
      });
    }
  }

  return results;
}
