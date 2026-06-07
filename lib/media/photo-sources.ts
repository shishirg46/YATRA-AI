interface SourcePhoto {
  url: string;
  thumbUrl?: string;
  title?: string;
  source: "wikipedia" | "commons" | "unsplash";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export async function getWikipediaImage(name: string): Promise<SourcePhoto | null> {
  const searchQuery = name.toLowerCase().includes("nepal") ? name : `${name} Nepal`;
  const wikiSearch = await fetchJson<{
    query?: { search?: Array<{ title: string }> };
  }>(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&utf8=1&format=json`);

  let title = wikiSearch?.query?.search?.[0]?.title;
  if (!title && name.toLowerCase().includes("nepal")) {
    const fallback = await fetchJson<{
      query?: { search?: Array<{ title: string }> };
    }>(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name.replace(/\s*Nepal/i, "").trim())}&utf8=1&format=json`);
    title = fallback?.query?.search?.[0]?.title ?? undefined;
  }
  if (!title) return null;

  const summary = await fetchJson<{
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    title?: string;
    content_urls?: { desktop?: { page?: string } };
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);

  const imgUrl = summary?.originalimage?.source || summary?.thumbnail?.source;
  if (!imgUrl) return null;

  return {
    url: imgUrl,
    thumbUrl: summary.thumbnail?.source,
    title: summary.title || title,
    source: "wikipedia",
  };
}

async function commonsPagesToPhotos(pages: Record<string, {
  title?: string;
  imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string }>;
}>): Promise<SourcePhoto[]> {
  const results: SourcePhoto[] = [];
  for (const p of Object.values(pages)) {
    const img = p.imageinfo?.[0];
    if (!img?.url) continue;
    results.push({
      url: img.url,
      thumbUrl: img.thumburl,
      title: p.title,
      source: "commons",
    });
  }
  return results;
}

export async function getCommonsGeo(
  lat: number,
  lon: number,
  radius: number = 5000,
  limit: number = 6
): Promise<SourcePhoto[]> {
  const commons = await fetchJson<{
    query?: {
      pages?: Record<string, {
        title?: string;
        imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string }>;
      }>;
    };
  }>(`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=${radius}&ggslimit=${limit}&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json`);

  if (!commons?.query?.pages) return [];
  return commonsPagesToPhotos(commons.query.pages);
}

export async function getCommonsByTitle(
  name: string,
  limit: number = 6
): Promise<SourcePhoto[]> {
  const commons = await fetchJson<{
    query?: {
      pages?: Record<string, {
        title?: string;
        imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string }>;
      }>;
    };
  }>(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name + " Nepal")}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json`);

  if (!commons?.query?.pages) return [];
  return commonsPagesToPhotos(commons.query.pages);
}

export async function getUnsplashImages(
  query: string,
  limit: number = 3
): Promise<SourcePhoto[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];

  const res = await fetchJson<{
    results?: Array<{
      urls?: { regular?: string; small?: string };
      alt_description?: string;
      links?: { html?: string };
    }>;
  }>(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=landscape`);

  if (!res?.results) return [];

  return res.results
    .filter((r) => r.urls?.regular)
    .map((r) => ({
      url: r.urls!.regular!,
      thumbUrl: r.urls?.small,
      title: r.alt_description || query,
      source: "unsplash" as const,
    }));
}

export async function findDestinationPhotos(
  name: string,
  lat?: number,
  lon?: number
): Promise<SourcePhoto[]> {
  const results: SourcePhoto[] = [];

  const wiki = await getWikipediaImage(name);
  if (wiki) results.push(wiki);

  if (lat != null && lon != null) {
    const geo = await getCommonsGeo(lat, lon);
    results.push(...geo);
  }

  if (results.length < 2) {
    const text = await getCommonsByTitle(name);
    results.push(...text);
  }

  if (results.length < 2) {
    const unsplash = await getUnsplashImages(`${name} Nepal`, 5);
    results.push(...unsplash);
  }

  const seen = new Set<string>();
  return results.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}
