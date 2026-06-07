import { v2 as cloudinary } from "cloudinary";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

export type PlaceDetailsResponse = {
  name: string;
  description: string;
  image: string;
  images: string[];
  wikipediaUrl?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  source: "wikipedia" | "cloudinary-cache" | "osm";
};

type WikiSearchItem = { title: string };
type WikiSummary = {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
  coordinates?: { lat: number; lon: number };
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const memoryCache = new Map<string, { expiresAt: number; value: PlaceDetailsResponse }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const cacheSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (now > entry.expiresAt) memoryCache.delete(key);
  }
}, 300_000);
if (typeof cacheSweep === "number" && process.env.NODE_ENV === "test") {
  clearInterval(cacheSweep);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cloudinaryImageUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    secure: true,
    fetch_format: "auto",
    quality: "auto",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function uploadImageFromUrl(remoteUrl: string, publicId: string): Promise<{
  public_id: string;
  secure_url: string;
}> {
  return cloudinary.uploader.upload(remoteUrl, {
    public_id: publicId,
    folder: "yatraai/place-details",
    overwrite: false,
    unique_filename: false,
    resource_type: "image",
    transformation: [{ fetch_format: "auto", quality: "auto" }],
  });
}

async function searchWikipedia(name: string): Promise<WikiSearchItem | null> {
  const query = encodeURIComponent(`${name} Nepal`);
  const data = await fetchJson<{ query?: { search?: WikiSearchItem[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&utf8=1`
  );
  return data?.query?.search?.[0] ?? null;
}

async function fetchWikipediaSummary(title: string): Promise<WikiSummary | null> {
  return fetchJson<WikiSummary>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
}

async function fetchWikimediaImages(title: string): Promise<string[]> {
  const data = await fetchJson<{
    query?: {
      pages?: Record<string, { imageinfo?: Array<{ url?: string }> }>;
    };
  }>(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      title
    )}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url&format=json`
  );

  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  const urls = pages
    .map((p) => p.imageinfo?.[0]?.url)
    .filter((u): u is string => typeof u === "string");
  return Array.from(new Set(urls)).slice(0, 5);
}

async function fetchOsmFallback(name: string): Promise<{
  coordinates?: { lat: number; lng: number };
  description?: string;
}> {
  const q = encodeURIComponent(`${name}, Nepal`);
  const data = await fetchJson<NominatimResult[]>(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`,
    { headers: { "User-Agent": "YatraAI/1.0 place-details" } }
  );
  const best = data?.[0];
  if (!best) return {};
  return {
    coordinates: { lat: Number(best.lat), lng: Number(best.lon) },
    description: best.display_name,
  };
}

function fromMemoryCache(key: string): PlaceDetailsResponse | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return hit.value;
}

function setMemoryCache(key: string, value: PlaceDetailsResponse): void {
  memoryCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

const CATEGORY_IMAGES: Record<string, string> = {
  MOUNTAIN: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Mount_Everest_as_seen_from_Drukair2.jpg/1280px-Mount_Everest_as_seen_from_Drukair2.jpg",
  TREKKING_VILLAGE: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Annapurna_South_View_from_Ghandruk.jpg/1280px-Annapurna_South_View_from_Ghandruk.jpg",
  LAKE: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Fewa_Taal.JPG/1280px-Fewa_Taal.JPG",
  TEMPLE: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Patan_Temple.jpg/1280px-Patan_Temple.jpg",
  FOREST: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Shivapuri_Nagarjun_National_Park.jpg/1280px-Shivapuri_Nagarjun_National_Park.jpg",
  WATERFALL: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Davis_Falls_Nepal.jpg/1280px-Davis_Falls_Nepal.jpg",
  RIVERSIDE: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Kali_Gandaki_River.jpg/1280px-Kali_Gandaki_River.jpg",
  VIEWPOINT: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Sarangkot_Pokhara_view.jpg/1280px-Sarangkot_Pokhara_view.jpg",
  HILL: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Nagarkot_hill_view.jpg/1280px-Nagarkot_hill_view.jpg",
  CAMP: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Trekking_camp_in_Nepal.jpg/1280px-Trekking_camp_in_Nepal.jpg",
  TOURIST_ATTRACTION: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Patan_Durbar_Square.jpg/1280px-Patan_Durbar_Square.jpg",
  MUNICIPALITY: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Kathmandu_downtown.jpg/1280px-Kathmandu_downtown.jpg",
  CHOWK: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Asan_Tole_Kathmandu.jpg/1280px-Asan_Tole_Kathmandu.jpg",
  MOUNTAIN_SETTLEMENT: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Mustang_village.jpg/1280px-Mustang_village.jpg",
  OTHER: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Nepal_mountains.jpg/1280px-Nepal_mountains.jpg",
};

export async function enrichPlaceDetails(placeName: string): Promise<PlaceDetailsResponse> {
  const trimmedName = placeName.trim();
  const normalized = normalizeName(trimmedName);

  const mem = fromMemoryCache(normalized);
  if (mem) return mem;

  const existing = await prisma.destination.findFirst({
    where: { normalizedName: normalized },
    orderBy: [{ verified: "desc" }, { dataQualityScore: "desc" }],
  });

  const isPlaceholder = (url: string) =>
    url.includes("cloudinary.com/demo/") || url.includes("samples/landscapes/");

  const existingImages = (existing?.tags ?? []).filter((t) => t.startsWith("gallery:")).map((t) => t.slice(8));
  if (existing?.image && existing?.description && !isPlaceholder(existing.image)) {
    const cached: PlaceDetailsResponse = {
      name: existing.name,
      description: existing.description,
      image: existing.image,
      images: existingImages,
      coordinates: { lat: existing.latitude, lng: existing.longitude },
      source: "cloudinary-cache",
    };
    setMemoryCache(normalized, cached);
    return cached;
  }

  const wikiHit = await searchWikipedia(trimmedName);
  const wikiTitle = wikiHit?.title ?? trimmedName;
  const wikiSummary = await fetchWikipediaSummary(wikiTitle);
  const wikiUrl = wikiSummary?.content_urls?.desktop?.page;
  const summaryText = wikiSummary?.extract?.trim();

  const candidateImageUrls: string[] = [];
  if (wikiSummary?.originalimage?.source) candidateImageUrls.push(wikiSummary.originalimage.source);
  if (wikiSummary?.thumbnail?.source) candidateImageUrls.push(wikiSummary.thumbnail.source);
  const commons = await fetchWikimediaImages(wikiTitle);
  for (const url of commons) candidateImageUrls.push(url);

  const uniqueCandidates = Array.from(new Set(candidateImageUrls)).slice(0, 5);
  const cloudinaryBaseId = `place_${normalized.replace(/\s+/g, "_")}`;
  const cloudinaryUrls: string[] = [];

  for (let i = 0; i < uniqueCandidates.length; i += 1) {
    const id = `${cloudinaryBaseId}_${i + 1}`;
    try {
      const uploaded = await uploadImageFromUrl(uniqueCandidates[i], id);
      cloudinaryUrls.push(uploaded.secure_url);
    } catch {
      cloudinaryUrls.push(cloudinaryImageUrl(`yatraai/place-details/${id}`));
    }
  }

  const primaryImage = cloudinaryUrls[0] ?? "";
  const gallery = cloudinaryUrls.slice(1, 5);

  let coordinates = wikiSummary?.coordinates
    ? { lat: wikiSummary.coordinates.lat, lng: wikiSummary.coordinates.lon }
    : undefined;
  let source: PlaceDetailsResponse["source"] = "wikipedia";

  if (!summaryText || !primaryImage) {
    const osm = await fetchOsmFallback(trimmedName);
    if (!coordinates && osm.coordinates) coordinates = osm.coordinates;
    if (!summaryText && osm.description) source = "osm";
  }

  const fallbackName = existing?.name || trimmedName;
  const description =
    summaryText ||
    `Travel destination in Nepal. Detailed source summary is not available yet for ${fallbackName}.`;
  const categoryDefault = existing?.category ? CATEGORY_IMAGES[existing.category] || CATEGORY_IMAGES.OTHER : CATEGORY_IMAGES.OTHER;
  const image = primaryImage || categoryDefault;

  const response: PlaceDetailsResponse = {
    name: wikiSummary?.title || existing?.name || trimmedName,
    description,
    image,
    images: gallery,
    wikipediaUrl: wikiUrl,
    coordinates,
    source,
  };

  // If name appears URL-encoded (contains %), use the fallbackName instead
  if (response.name.includes('%')) {
    response.name = fallbackName;
  }

  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []).filter((t) => !t.startsWith("gallery:")), ...gallery.map((g) => `gallery:${g}`)]));
    await prisma.destination.update({
      where: { id: existing.id },
      data: {
        description: response.description,
        image: response.image,
        sourceLastFetch: new Date(),
        tags,
      },
    }).catch((err) => console.error("[placeDetails] Failed to update destination:", err));
  }

  setMemoryCache(normalized, response);
  return response;
}

