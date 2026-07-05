import { prisma } from "@/lib/prisma";

const HAZARD_TYPE_MAP: Record<number, string> = {
  1: "AIRCRAFT_ACCIDENT",
  2: "ANIMAL",
  3: "AVALANCHE",
  4: "BOAT_CAPsize",
  5: "BRIDGE_COLLAPSE",
  6: "COLD_WAVE",
  7: "DROWNING",
  8: "EARTHQUAKE",
  9: "EPIDEMIC",
  10: "FIRE",
  11: "FLOOD",
  12: "FOREST_FIRE",
  13: "HAILSTORM",
  14: "HEAVY_RAINFALL",
  15: "HELICOPTER_CRASH",
  16: "HIGH_ALTITUDE",
  17: "LANDSLIDE",
  18: "OTHER_NATURAL",
  19: "RAINFALL",
  20: "SNAKE_BITE",
  21: "SNOW_STORM",
  22: "STORM",
  23: "THUNDERBOLT",
  24: "WIND_STORM",
  25: "DROUGHT",
  26: "GLOF",
  27: "HEAT_WAVE",
  28: "INUNDATION",
  29: "SOIL_EROSION",
  30: "VOLCANIC",
  31: "INDUSTRIAL",
  32: "MINE",
  33: "PANDEMIC",
  34: "ROAD_ACCIDENT",
  35: "ANIMAL_FLU",
  36: "DEFORESTATION",
  37: "POLLUTION",
  38: "FAMINE",
  39: "FOOD_POISONING",
  40: "GAS_EXPLOSION",
  41: "CHEMICAL_LEAK",
  42: "RADIATION_LEAK",
  43: "TOXIC_GAS_LEAK",
  44: "MICROBE_ATTACK",
  45: "OTHER_NON_NATURAL",
  46: "WATER_ACCIDENT",
  47: "RESPONSE_ACCIDENT",
};

const HAZARD_CATEGORY: Record<number, string> = {
  1: "INFO",
  2: "INFO",
  3: "LANDSLIDE",
  4: "INFO",
  5: "INFO",
  6: "STORM",
  7: "INFO",
  8: "EARTHQUAKE",
  9: "INFO",
  10: "FIRE",
  11: "FLOOD",
  12: "FIRE",
  13: "STORM",
  14: "STORM",
  15: "INFO",
  16: "INFO",
  17: "LANDSLIDE",
  18: "INFO",
  19: "STORM",
  20: "INFO",
  21: "STORM",
  22: "STORM",
  23: "STORM",
  24: "STORM",
  25: "STORM",
  26: "FLOOD",
  27: "STORM",
  28: "FLOOD",
  29: "LANDSLIDE",
  30: "INFO",
  31: "INFO",
  32: "INFO",
  33: "INFO",
  34: "INFO",
  35: "INFO",
  36: "INFO",
  37: "INFO",
  38: "INFO",
  39: "INFO",
  40: "FIRE",
  41: "INFO",
  42: "INFO",
  43: "INFO",
  44: "INFO",
  45: "INFO",
  46: "INFO",
  47: "INFO",
};

const DISTRICT_NP_TO_EN: Record<string, string> = {
  "अछाम": "Achham",
  "अर्घाखाँची": "Arghakhanchi",
  "बागलुङ": "Baglung",
  "बैतडी": "Baitadi",
  "बझाङ": "Bajhang",
  "बझाङ्ग": "Bajhang",
  "बाजुरा": "Bajura",
  "बाँके": "Banke",
  "बारा": "Bara",
  "बर्दिया": "Bardiya",
  "भक्तपुर": "Bhaktapur",
  "भोजपुर": "Bhojpur",
  "चितवन": "Chitwan",
  "दादेलधुरा": "Dadeldhura",
  "दैलेख": "Dailekh",
  "दाङ": "Dang",
  "दार्चुला": "Darchula",
  "धादिङ": "Dhading",
  "धनकुटा": "Dhankuta",
  "धनुषा": "Dhanusha",
  "दोलखा": "Dolakha",
  "दोल्पा": "Dolpa",
  "डोटी": "Doti",
  "पूर्वी रुकुम": "Eastern Rukum",
  "गोरखा": "Gorkha",
  "गुल्मी": "Gulmi",
  "हुम्ला": "Humla",
  "इलाम": "Ilam",
  "जाजरकोट": "Jajarkot",
  "झापा": "Jhapa",
  "जुम्ला": "Jumla",
  "कैलाली": "Kailali",
  "कालिकोट": "Kalikot",
  "कञ्चनपुर": "Kanchanpur",
  "कन्चनपुर": "Kanchanpur",
  "कपिलवस्तु": "Kapilvastu",
  "कास्की": "Kaski",
  "काठमाडौं": "Kathmandu",
  "काठमाडौँ": "Kathmandu",
  "काठमाण्डौ": "Kathmandu",
  "काभ्रेपलान्चोक": "Kavrepalanchok",
  "खोटाङ": "Khotang",
  "ललितपुर": "Lalitpur",
  "लमजुङ": "Lamjung",
  "महोत्तरी": "Mahottari",
  "मकवानपुर": "Makwanpur",
  "मनाङ": "Manang",
  "मोरङ": "Morang",
  "मोरङ्ग": "Morang",
  "मुगु": "Mugu",
  "मुस्ताङ": "Mustang",
  "म्याग्दी": "Myagdi",
  "नवलपुर": "Nawalpur",
  "नुवाकोट": "Nuwakot",
  "ओखलढुङ्गा": "Okhaldhunga",
  "पाल्पा": "Palpa",
  "पाँचथर": "Panchthar",
  "पर्सा": "Parsa",
  "पर्वत": "Parbat",
  "प्युठान": "Pyuthan",
  "रामेछाप": "Ramechhap",
  "रसुवा": "Rasuwa",
  "रौतहट": "Rautahat",
  "रोल्पा": "Rolpa",
  "रूपन्देही": "Rupandehi",
  "पश्चिम रुकुम": "Western Rukum",
  "रुकुम पश्चिम": "Western Rukum",
  "सल्यान": "Salyan",
  "सङ्खुवासभा": "Sankhuwasabha",
  "सप्तरी": "Saptari",
  "सर्लाही": "Sarlahi",
  "सिन्धुली": "Sindhuli",
  "सिन्धुपाल्चोक": "Sindhupalchok",
  "सिराहा": "Siraha",
  "सोलुखुम्बु": "Solukhumbu",
  "सुनसरी": "Sunsari",
  "सुर्खेत": "Surkhet",
  "स्याङ्जा": "Syangja",
  "स्याङ्गजा": "Syangja",
  "तनहुँ": "Tanahun",
  "ताप्लेजुङ": "Taplejung",
  "ताप्लेजुङ्ग": "Taplejung",
  "तेह्रथुम": "Terhathum",
  "उदयपुर": "Udayapur",
  "नवलपरासी": "Parasi",
};

function getSeverity(hazardId: number, deaths: number, injured: number): string {
  if (hazardId === 8 || deaths > 5) return "CRITICAL";
  if (deaths > 0 || injured > 5) return "HIGH";
  if (injured > 0 || hazardId === 11 || hazardId === 28 || hazardId === 14 || hazardId === 17) return "MEDIUM";
  return "LOW";
}

export interface BipadRawIncident {
  id: number;
  title?: string;
  titleNe?: string;
  hazard?: number;
  incidentOn?: string;
  point?: { coordinates?: [number, number] };
  loss?: {
    peopleDeathCount?: number;
    peopleInjuredCount?: number;
    peopleMissingCount?: number;
    peopleAffectedCount?: number;
    estimatedLoss?: number;
  };
}

export interface NormalizedBipadAlert {
  id: string;
  hazardId: number;
  type: string;
  title: string;
  body: string;
  location: string;
  district: string;
  severity: string;
  date: string;
  lat: number;
  lon: number;
  deaths: number;
  injured: number;
}

function parseTitleNe(titleNe: string): { districtNp: string | null; locationNp: string | null } {
  if (!titleNe) return { districtNp: null, locationNp: null };
  const parts = titleNe.split(",").map((s) => s.trim());
  if (parts.length < 2) return { districtNp: null, locationNp: null };
  let raw = parts[1];
  // Strip parenthetical suffixes like (बर्दघाट सुस्ता पूर्व)
  raw = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { districtNp: raw, locationNp: parts.slice(2).join(", ") || null };
}

function districtNpToEn(np: string): string {
  const exact = DISTRICT_NP_TO_EN[np];
  if (exact) return exact;
  // Fallback: find a key that is contained in, or contains, the input
  for (const [key, en] of Object.entries(DISTRICT_NP_TO_EN)) {
    if (np.includes(key) || key.includes(np)) return en;
  }
  return np;
}

export async function fetchRecentBipadIncidents(hours = 24): Promise<NormalizedBipadAlert[]> {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString().split("T")[0];

  const url = `https://bipadportal.gov.np/api/v1/incident/?expand=loss,event,wards&data_source=drr_api&incident_on__gt=${from}&incident_on__lt=${to}&limit=500&ordering=-incident_on`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: BipadRawIncident[] };
    const rows = data.results ?? [];

    return rows
      .map((inc): NormalizedBipadAlert | null => {
        const hazardId = inc.hazard ?? 0;
        const hazardType = HAZARD_CATEGORY[hazardId] || "INFO";
        const coords = inc.point?.coordinates;
        if (!coords || coords.length < 2) return null;

        const lon = coords[0];
        const lat = coords[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const { districtNp } = parseTitleNe(inc.titleNe ?? "");
        const districtEn = districtNp ? districtNpToEn(districtNp) : "";
        const locationText = inc.title ?? "";
        const deaths = inc.loss?.peopleDeathCount ?? 0;
        const injured = inc.loss?.peopleInjuredCount ?? 0;

        return {
          id: `bipad-${inc.id}`,
          hazardId,
          type: hazardType,
          title: inc.title ?? `${hazardType} in ${districtEn || "Nepal"}`,
          body: `${inc.title ?? `Incident in ${districtEn || "Nepal"}`}.${deaths > 0 ? ` Deaths: ${deaths}.` : ""}${injured > 0 ? ` Injured: ${injured}.` : ""}`,
          location: locationText || districtEn || "Nepal",
          district: districtEn,
          severity: getSeverity(hazardId, deaths, injured),
          date: inc.incidentOn ?? new Date().toISOString().split("T")[0],
          lat,
          lon,
          deaths,
          injured,
        };
      })
      .filter((a): a is NormalizedBipadAlert => !!a);
  } catch {
    return [];
  }
}

export async function matchAlertsToUsers(alerts: NormalizedBipadAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { homeLocationId: { not: null } },
    select: { id: true },
  });

  if (users.length === 0) return 0;

  let written = 0;

  for (const alert of alerts) {
    if (!alert.district) continue;

    const affectedUsers = users;

    const message = JSON.stringify({
      _type: "HAZARD",
      hazardType: alert.type,
      title: alert.title,
      body: alert.body,
      location: alert.location,
      severity: alert.severity,
      bipadId: alert.id,
      date: alert.date,
    });

    const existing = await prisma.notification.findFirst({
      where: { message: { contains: alert.id } },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.notification.createMany({
      data: affectedUsers.map((u) => ({ userId: u.id, message })),
    });

    written += affectedUsers.length;
    console.log(`[bipad-alerts] ${alert.title} (${alert.district}) → ${affectedUsers.length} users notified`);
  }

  return written;
}
