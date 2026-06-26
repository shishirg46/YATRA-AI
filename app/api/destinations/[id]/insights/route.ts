export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { getDestinationPhotos } from "@/lib/media/photo-cache";

type InsightSource = { name: string; url: string; snippet: string };
type InsightPhoto = { url: string; thumbUrl?: string; title?: string; sourceUrl: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function shorten(text: string, max = 260): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function getInsightsHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Try UUID lookup first, fall back to name lookup for slugs like "Barju_Taal"
  let location = await prisma.location.findUnique({
    where: { id },
    include: { district: { include: { province: true } } },
  });

  if (!location) {
    location = await prisma.location.findFirst({
      where: { name: { equals: id, mode: "insensitive" } },
      include: { district: { include: { province: true } } },
    });
  }

  if (!location) {
    return NextResponse.json({ message: "Destination not found." }, { status: 404 });
  }

  const query = `${location.name} ${location.district.name} Nepal`;
  const encodedQuery = encodeURIComponent(query);

  const wikiSearch = await fetchJson<{
    query?: { search?: Array<{ title: string }> };
  }>(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&utf8=1&format=json`);

  const pageTitle = wikiSearch?.query?.search?.[0]?.title ?? location.name;
  const wikiSummary = await fetchJson<{
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    title?: string;
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);

  const pageProps = await fetchJson<{
    query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
  }>(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageprops&format=json`
  );

  const page = pageProps?.query?.pages ? Object.values(pageProps.query.pages)[0] : null;
  const wikidataId = page?.pageprops?.wikibase_item;
  const wikidata = wikidataId
    ? await fetchJson<Record<string, { entities?: Record<string, { descriptions?: Record<string, { value: string }> }> }>>(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`
      )
    : null;

  const wikidataDescription =
    (wikidata && wikidata[Object.keys(wikidata)[0]]?.entities?.[wikidataId ?? ""]?.descriptions?.en?.value) || null;

  const nominatimBase = process.env.NOMINATIM_URL || process.env.NEXT_PUBLIC_NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const osmReverse = await fetchJson<{
    display_name?: string;
    type?: string;
    category?: string;
  }>(`${nominatimBase}/reverse?lat=${location.latitude}&lon=${location.longitude}&format=jsonv2`, {
    headers: { "User-Agent": "YatraAI/1.0 (destination insights)" },
  });

  const sources: InsightSource[] = [];

  if (wikiSummary?.extract) {
    sources.push({
      name: "Wikipedia",
      url: wikiSummary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
      snippet: shorten(wikiSummary.extract),
    });
  }
  if (wikidataDescription) {
    sources.push({
      name: "Wikidata",
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
      snippet: shorten(wikidataDescription),
    });
  }
  if (osmReverse?.display_name) {
    sources.push({
      name: "OpenStreetMap",
      url: `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=12/${location.latitude}/${location.longitude}`,
      snippet: shorten(`${osmReverse.display_name} (${osmReverse.category ?? "place"}: ${osmReverse.type ?? "unknown"})`),
    });
  }

  // Look up destination to check for cached photos
  const destination = await prisma.destination.findFirst({
    where: {
      name: location.name,
      district: location.district.name,
      province: location.district.province.name,
    },
  });

  let photos: InsightPhoto[] = [];
  if (destination) {
    const cached = await getDestinationPhotos(
      destination.id,
      destination.name,
      destination.latitude,
      destination.longitude,
    );
    photos = cached.map((p) => ({
      url: p.url,
      thumbUrl: p.thumbUrl ?? undefined,
      title: p.title ?? undefined,
      sourceUrl: p.sourceUrl,
    }));
  }
  const overview =
    sources.map((s) => s.snippet).find(Boolean) ||
    `${location.name} is in ${location.district.name}, ${location.district.province.name}.`;

  return NextResponse.json({
    location: {
      id: location.id,
      name: location.name,
      district: location.district.name,
      province: location.district.province.name,
      latitude: location.latitude,
      longitude: location.longitude,
    },
    overview,
    sources,
    photos,
    fetchedAt: new Date().toISOString(),
  });
}

export const GET = withRateLimit(getInsightsHandler, { max: 20, windowSeconds: 60 });
