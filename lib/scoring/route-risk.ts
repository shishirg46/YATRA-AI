import { haversineKm } from "@/lib/routing/geo";

export type RouteRiskLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";

export interface RouteRiskResult {
  routeRiskScore: number;
  routeRiskLevel: RouteRiskLevel;
  routeDistanceKm: number;
  decisionTrace: { reasoning: string[] };
  dataSource: string;
}

type TerrainZone = "TERAI" | "HILL" | "MOUNTAIN" | "HIMAL";

function getTerrainZone(alt: number | null): TerrainZone {
  const a = alt ?? 0;
  if (a < 500) return "TERAI";
  if (a < 3000) return "HILL";
  if (a < 5000) return "MOUNTAIN";
  return "HIMAL";
}

function scoreToLevel(score: number): RouteRiskLevel {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

export interface HazardDataPoint {
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  heatIndex: number;
  airQuality: number;
}

export interface DestinationHazard {
  district: string;
  hazard: HazardDataPoint;
}

export interface SeasonalCounts {
  flood: number;
  landslide: number;
  earthquake: number;
}

export interface DisasterCounts {
  /** Events that occurred during monsoon months (Jun-Sep) */
  monsoon: SeasonalCounts;
  /** Events that occurred during dry months (Oct-May) */
  dry: SeasonalCounts;
}

export interface RouteRiskParams {
  originLat: number;
  originLon: number;
  destLat: number;
  destLon: number;
  originAlt: number | null;
  destAlt: number | null;
  originDistrict?: string;
  destDistrict?: string;
  isMonsoon: boolean;
  currentMonth?: number; // 1-12, used for season-appropriate disaster weighting
  purposes: string[];
  /** Real-time hazard data at the user's origin (from BIPAD/EONET/USGS etc.) */
  originHazard?: HazardDataPoint;
  /** Real-time hazard data at the destination district (from DB or API) */
  destHazard?: HazardDataPoint;
  /** Community-submitted hazard report penalty (pre-computed) */
  communityHazardPenalty?: number;
  /**
   * Pre-built lookup: any lat/lon → district name.
   * Used to map corridor sample points to districts for disaster-aware risk.
   * Array of {dist, district} sorted by proximity (just find first match within 50km).
   */
  corridorDistrictLookup?: Array<{ lat: number; lon: number; district: string }>;
  /** Historic disaster counts per district (last 5 years) */
  historicDisasters?: Map<string, DisasterCounts>;
  /** Recent disaster counts per district (last 30 days) */
  recentDisasters?: Map<string, DisasterCounts>;
}

const HIGH_SEISMIC_DISTRICTS = new Set([
  "sindhupalchok", "gorkha", "nuwakot", "dolakha", "kavrepalanchok",
  "rasuwa", "dhading", "makwanpur", "lamjung", "kaski",
  "solukhumbu", "ramechhap", "sindhuli", "okhaldhunga",
]);

const MODERATE_SEISMIC_DISTRICTS = new Set([
  "kathmandu", "bhaktapur", "lalitpur", "tanahu", "syangja",
  "parbat", "baglung", "myagdi", "mustang", "manang",
  "rukum", "rolpa", "jajarkot", "surkhet", "dailekh",
]);

function sampleRoutePoints(
  oLat: number, oLon: number,
  dLat: number, dLon: number,
  count: number,
): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    points.push({
      lat: oLat + (dLat - oLat) * t,
      lon: oLon + (dLon - oLon) * t,
    });
  }
  return points;
}

function classifyZone(lat: number): "TERAI" | "HILL" | "MOUNTAIN" {
  if (lat < 27.0) return "TERAI";
  if (lat < 28.2) return "HILL";
  return "MOUNTAIN";
}

/** Find district for a corridor point using nearest-neighbor over pre-built lookup. */
function lookupDistrict(
  lat: number, lon: number,
  lookup: Array<{ lat: number; lon: number; district: string }>,
): string | null {
  let best: string | null = null;
  let bestDist = 30; // 30km max match radius
  for (const p of lookup) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = p.district;
    }
  }
  return best;
}

const emptySeasonal: SeasonalCounts = { flood: 0, landslide: 0, earthquake: 0 };
const emptyCounts: DisasterCounts = { monsoon: emptySeasonal, dry: emptySeasonal };

function isMonsoonMonth(m: number): boolean {
  return m >= 6 && m <= 9;
}

function getSeasonalFactor(currentMonth: number): { floodFactor: number; landslideFactor: number } {
  // Floods outside monsoon are anomalous — weight them at 20%
  // Landslides still happen in dry season — weight at 50%
  // Earthquakes are not seasonal
  if (isMonsoonMonth(currentMonth)) {
    return { floodFactor: 1.0, landslideFactor: 1.0 };
  }
  return { floodFactor: 0.2, landslideFactor: 0.5 };
}

function disasterPenalty(
  historic: DisasterCounts,
  recent: DisasterCounts,
  currentMonth: number,
): { penalty: number; labels: string[] } {
  let p = 0;
  const labels: string[] = [];
  const { floodFactor, landslideFactor } = getSeasonalFactor(currentMonth);

  // Use season-appropriate counts
  const isMonsoon = isMonsoonMonth(currentMonth);
  const histUse = isMonsoon ? historic.monsoon : historic.dry;
  const recentUse = isMonsoon ? recent.monsoon : recent.dry;

  // Historic landslides
  if (histUse.landslide > 5) {
    const hPen = Math.min(histUse.landslide / 10, 1) * 8 * landslideFactor;
    p += hPen;
    labels.push(`historic landslides (${histUse.landslide})`);
  }

  // Historic floods — only relevant if traveling in/around monsoon
  if (histUse.flood > 5) {
    const fPen = Math.min(histUse.flood / 10, 1) * 6 * floodFactor;
    p += fPen;
    labels.push(`historic floods (${histUse.flood})`);
  }

  // Recent landslides
  if (recentUse.landslide > 0) {
    const rPen = Math.min(recentUse.landslide, 5) * 3 * landslideFactor;
    p += rPen;
    labels.push(`recent landslides (${recentUse.landslide})`);
  }

  // Recent floods — weighted by seasonal relevance
  if (recentUse.flood > 0) {
    const rPen = Math.min(recentUse.flood, 5) * 2.5 * floodFactor;
    p += rPen;
    labels.push(`active floods (${recentUse.flood})`);
  }

  return { penalty: p, labels };
}

export function computeRouteRisk(params: RouteRiskParams): RouteRiskResult {
  const {
    originLat, originLon, destLat, destLon,
    originAlt, destAlt,
    originDistrict, destDistrict,
    isMonsoon, purposes, originHazard, destHazard,
  } = params;

  const distanceKm = haversineKm(originLat, originLon, destLat, destLon);
  const oAltFinal = originAlt ?? 0;
  const dAltFinal = destAlt ?? 0;
  const oZone = getTerrainZone(oAltFinal);
  const dZone = getTerrainZone(dAltFinal);
  const reasoning: string[] = [];
  const sources = new Set<string>(["geographic"]);

  let penalty = 0;

  // ── 1. Distance penalty ────────────────────────────────────────────
  const distPenalty = Math.min(distanceKm / 300, 1) * 15;
  penalty += distPenalty;
  if (distPenalty > 8) {
    reasoning.push(`Long route (${Math.round(distanceKm)}km) — prolonged hazard exposure`);
  }

  // ── 2. Terrain analysis: sample 7 corridor points ──────────────────
  const samples = sampleRoutePoints(originLat, originLon, destLat, destLon, 7);
  const zoneCounts: Record<string, number> = { TERAI: 0, HILL: 0, MOUNTAIN: 0 };
  for (const s of samples) {
    const z = classifyZone(s.lat);
    zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
  }

  const n = samples.length; // always 7
  const teraiFrac = (zoneCounts.TERAI ?? 0) / n;
  const hillFrac = (zoneCounts.HILL ?? 0) / n;
  const mountainFrac = (zoneCounts.MOUNTAIN ?? 0) / n;
  const multipleZoneFrac =
    [teraiFrac > 0, hillFrac > 0, mountainFrac > 0].filter(Boolean).length > 1
      ? 1 : 0;

  // ── 3. Terrain zone hazard inference (proportional to corridor fraction) ──
  if (teraiFrac > 0) {
    const floodBase = (isMonsoon ? 10 : 3) * teraiFrac;
    penalty += floodBase;
    if (isMonsoon) reasoning.push(`Route crosses Terai for ${(teraiFrac * 100).toFixed(0)}% of corridor — flood risk during monsoon`);
  }

  if (hillFrac > 0) {
    const lsBase = (isMonsoon ? 10 : 3) * hillFrac;
    penalty += lsBase;
    if (isMonsoon) reasoning.push(`Route crosses hills for ${(hillFrac * 100).toFixed(0)}% of corridor — landslide risk on winding roads`);
  }

  if (mountainFrac > 0) {
    penalty += 8 * mountainFrac;
    reasoning.push(`Route crosses high mountain terrain for ${(mountainFrac * 100).toFixed(0)}% of corridor — altitude and remoteness risk`);
  }

  if (multipleZoneFrac) {
    penalty += 4;
    reasoning.push("Route crosses multiple terrain zones — road conditions vary significantly");
  }

  // Destination terrain penalty
  if (dZone === "HIMAL") penalty += 8;
  else if (dZone === "MOUNTAIN") penalty += 5;
  else if (dZone === "HILL") penalty += 2;

  // ── 3b. Corridor disaster scan — actual historic + recent events ────
  // Uses yatra_disaster_events counts per district to replace heuristic
  // "crosses hill = landslide" with real data.
  const histDisasters = params.historicDisasters;
  const recentDisasters = params.recentDisasters;
  const districtLookup = params.corridorDistrictLookup;

  if (histDisasters && recentDisasters && districtLookup && districtLookup.length > 0) {
    const traversedDistricts = new Set<string>();
    for (const s of samples) {
      const dist = lookupDistrict(s.lat, s.lon, districtLookup);
      if (dist) traversedDistricts.add(dist.toLowerCase());
    }
    // Also include origin + dest districts
    if (originDistrict) traversedDistricts.add(originDistrict.toLowerCase());
    if (destDistrict) traversedDistricts.add(destDistrict.toLowerCase());

    let corridorLabels: string[] = [];
    for (const d of traversedDistricts) {
      const hist = histDisasters.get(d) ?? emptyCounts;
      const recent = recentDisasters.get(d) ?? emptyCounts;
      const travelMonth = params.currentMonth ?? (isMonsoon ? 7 : 1);
      const { penalty: dp, labels } = disasterPenalty(hist, recent, travelMonth);
      if (dp > 0) {
        penalty += dp;
        corridorLabels.push(`${d}: ${labels.join(", ")}`);
      }
    }
    if (corridorLabels.length > 0) {
      reasoning.push(`Disaster history along corridor — ${corridorLabels.join("; ")}`);
    }
  }

  // ── 4. Altitude differential ───────────────────────────────────────
  const altDiff = Math.abs(dAltFinal - oAltFinal);
  const altDiffPenalty = Math.min(altDiff / 3000, 1) * 10;
  penalty += altDiffPenalty;
  if (altDiffPenalty > 5) {
    reasoning.push(`Altitude change of ${Math.round(altDiff)}m — allow acclimatisation`);
  }

  // ── 5. District-level seismic risk ─────────────────────────────────
  const oDistLower = (originDistrict ?? "").toLowerCase();
  const dDistLower = (destDistrict ?? "").toLowerCase();

  if (HIGH_SEISMIC_DISTRICTS.has(oDistLower) || HIGH_SEISMIC_DISTRICTS.has(dDistLower)) {
    penalty += 8;
    reasoning.push("Route crosses high seismic hazard zone — earthquake risk");
    sources.add("seismic-zones");
  } else if (MODERATE_SEISMIC_DISTRICTS.has(oDistLower) || MODERATE_SEISMIC_DISTRICTS.has(dDistLower)) {
    penalty += 4;
  }

  // ── 6. Real-time hazard data integration ───────────────────────────
  // Distance-weighted blend of origin and destination hazard along the corridor.
  // This captures hazards mid-route (not just at endpoints).

  const oH = originHazard ?? { floodIndex: 0, landslideIndex: 0, earthquakeIndex: 0, heatIndex: 0, airQuality: 0 };
  const dH = destHazard ?? { floodIndex: 0, landslideIndex: 0, earthquakeIndex: 0, heatIndex: 0, airQuality: 0 };
  const hazardDistWeight = Math.min(distanceKm / 100, 1); // full blending beyond 100km

  let floodRt = oH.floodIndex * (1 - hazardDistWeight) + dH.floodIndex * hazardDistWeight;
  let lsRt = oH.landslideIndex * (1 - hazardDistWeight) + dH.landslideIndex * hazardDistWeight;
  let eqRt = oH.earthquakeIndex * (1 - hazardDistWeight) + dH.earthquakeIndex * hazardDistWeight;
  let aqRt = oH.airQuality * (1 - hazardDistWeight) + dH.airQuality * hazardDistWeight;

  // Also bring in the max as a ceiling so single-point extreme hazards aren't missed
  if (destHazard) {
    floodRt = Math.max(floodRt, destHazard.floodIndex * hazardDistWeight * 0.3);
    lsRt = Math.max(lsRt, destHazard.landslideIndex * hazardDistWeight * 0.3);
    eqRt = Math.max(eqRt, destHazard.earthquakeIndex * hazardDistWeight * 0.3);
    aqRt = Math.max(aqRt, destHazard.airQuality * hazardDistWeight * 0.3);
    sources.add("dest-hazard");
  }
  if (originHazard) sources.add("origin-hazard");

  let dynamicMsg: string[] = [];
  const HAZARD_THRESHOLD = 0.05;

  if (floodRt > HAZARD_THRESHOLD) {
    const floodAmp = teraiFrac > 0 ? 1 + floodRt * teraiFrac * 2 : 1;
    penalty += 10 * floodRt * floodAmp;
    dynamicMsg.push(`flood ${(floodRt * 100).toFixed(0)}%`);
    sources.add("realtime-flood");
  }

  if (lsRt > HAZARD_THRESHOLD) {
    const lsAmp = hillFrac > 0 ? 1 + lsRt * hillFrac * 2 : 1;
    penalty += 10 * lsRt * lsAmp;
    dynamicMsg.push(`landslide ${(lsRt * 100).toFixed(0)}%`);
    sources.add("realtime-landslide");
  }

  if (eqRt > HAZARD_THRESHOLD) {
    const eqAmp = mountainFrac > 0 ? 1 + eqRt * mountainFrac : 1;
    penalty += 8 * eqRt * eqAmp;
    dynamicMsg.push(`earthquake ${(eqRt * 100).toFixed(0)}%`);
    sources.add("realtime-earthquake");
  }

  if (aqRt > 0.3) {
    penalty += 3;
    dynamicMsg.push(`poor air quality ${(aqRt * 100).toFixed(0)}%`);
  }

  if (dynamicMsg.length > 0) {
    reasoning.push(`Active hazard along route corridor — ${dynamicMsg.join(", ")}`);
  }

  // ── 7. Community-sourced hazard reports ────────────────────────────
  const communityPenalty = params.communityHazardPenalty ?? 0;
  if (communityPenalty > 0) {
    penalty += communityPenalty;
    reasoning.push(`Community hazard reports add +${communityPenalty} risk penalty`);
    sources.add("community-reports");
  }

  // ── 9. Monsoon base ────────────────────────────────────────────────
  if (isMonsoon && teraiFrac === 0) {
    penalty += 3;
  }

  // ── 10. Health / purpose multipliers ────────────────────────────────
  const hasTrekking = purposes.includes("TREKKING");
  const hasSolo = purposes.includes("SOLO");
  const hasLowFit = purposes.includes("HEALTH:low_fitness");
  const hasMobility = purposes.includes("HEALTH:mobility");
  const hasHeart = purposes.includes("HEALTH:heart");
  const hasDiabetes = purposes.includes("HEALTH:diabetes");
  const hasAsthma = purposes.includes("HEALTH:asthma");

  if (hasTrekking) { penalty *= 1.15; reasoning.push("Trekking — route risk weighted 1.15x"); }
  if (hasSolo)     { penalty *= 1.1;  reasoning.push("Solo travel — route risk weighted 1.1x"); }
  if (hasLowFit)   { penalty *= 1.1;  reasoning.push("Low fitness — route difficulty weighted higher"); }
  if (hasMobility) { penalty *= 1.2;  reasoning.push("Mobility limitation — terrain weighted ×1.2"); }
  if (hasHeart)    { penalty *= 1.1;  reasoning.push("Heart condition — altitude change weighted higher"); }
  if (hasDiabetes) { penalty *= 1.05; reasoning.push("Diabetes — limited medical access on route weighted higher"); }
  if (hasAsthma)   { penalty *= 1.05; reasoning.push("Asthma — altitude and air quality along route weighted higher"); }

  // ── Final score ────────────────────────────────────────────────────
  const finalScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const level = scoreToLevel(finalScore);

  if (reasoning.length === 0) {
    reasoning.push("Short route in low-risk terrain — favourable travel conditions");
  }

  return {
    routeRiskScore: finalScore,
    routeRiskLevel: level,
    routeDistanceKm: Math.round(distanceKm * 10) / 10,
    decisionTrace: { reasoning },
    dataSource: [...sources].join("+"),
  };
}
