export interface SeasonalCounts {
  flood: number;
  landslide: number;
  earthquake: number;
}

export interface DisasterCounts {
  monsoon: SeasonalCounts;
  dry: SeasonalCounts;
}

export interface CorridorAnchor {
  lat: number;
  lon: number;
  district: string;
}

const emptySeasonal: SeasonalCounts = { flood: 0, landslide: 0, earthquake: 0 };

function makeCounts(): DisasterCounts {
  return { monsoon: { ...emptySeasonal }, dry: { ...emptySeasonal } };
}

interface DisasterRow {
  district: string;
  type: string;
  monsoon_count: bigint;
  dry_count: bigint;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchDisasterCounts(prisma: any): Promise<{
  historicDisasters: Map<string, DisasterCounts>;
  recentDisasters: Map<string, DisasterCounts>;
}> {
  const fiveYrAgo = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const historicDisasters = new Map<string, DisasterCounts>();
  const recentDisasters = new Map<string, DisasterCounts>();

  try {
    const rawHist = await prisma.$queryRaw<DisasterRow[]>`
      SELECT
        metadata->>'district' AS district,
        type,
        COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date) BETWEEN 6 AND 9)::bigint AS monsoon_count,
        COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date) NOT BETWEEN 6 AND 9)::bigint AS dry_count
      FROM "yatra_disaster_events"
      WHERE date >= ${fiveYrAgo}
        AND metadata->>'district' IS NOT NULL
      GROUP BY metadata->>'district', type
    `;
    for (const r of rawHist) {
      const d = r.district.toLowerCase();
      if (!historicDisasters.has(d)) historicDisasters.set(d, makeCounts());
      const h = historicDisasters.get(d)!;
      const mc = Number(r.monsoon_count);
      const dc = Number(r.dry_count);
      if (r.type === "flood") { h.monsoon.flood += mc; h.dry.flood += dc; }
      else if (r.type === "landslide") { h.monsoon.landslide += mc; h.dry.landslide += dc; }
      else if (r.type === "earthquake") { h.monsoon.earthquake += mc; h.dry.earthquake += dc; }
    }

    const rawRecent = await prisma.$queryRaw<DisasterRow[]>`
      SELECT
        metadata->>'district' AS district,
        type,
        COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date) BETWEEN 6 AND 9)::bigint AS monsoon_count,
        COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date) NOT BETWEEN 6 AND 9)::bigint AS dry_count
      FROM "yatra_disaster_events"
      WHERE date >= ${thirtyDaysAgo}
        AND metadata->>'district' IS NOT NULL
      GROUP BY metadata->>'district', type
    `;
    for (const r of rawRecent) {
      const d = r.district.toLowerCase();
      if (!recentDisasters.has(d)) recentDisasters.set(d, makeCounts());
      const h = recentDisasters.get(d)!;
      const mc = Number(r.monsoon_count);
      const dc = Number(r.dry_count);
      if (r.type === "flood") { h.monsoon.flood += mc; h.dry.flood += dc; }
      else if (r.type === "landslide") { h.monsoon.landslide += mc; h.dry.landslide += dc; }
      else if (r.type === "earthquake") { h.monsoon.earthquake += mc; h.dry.earthquake += dc; }
    }
  } catch {
    // Continue without disaster data
  }

  return { historicDisasters, recentDisasters };
}

export function buildCorridorLookup(
  anchors: CorridorAnchor[],
): CorridorAnchor[] {
  return anchors.filter((a) => a.lat && a.lon && a.district);
}
