import { prisma } from "@/lib/prisma";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import {
  computeSafetyScore,
  buildHealthFlags,
} from "@/lib/scoring/safety";
import { assessRouteSegment } from "@/lib/analysis/group-risk";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";

export interface LiveDestinationResult {
  destination: unknown;
  weather: {
    temperature: number;
    humidity: number;
    rainfall: number;
    windSpeed: number;
    pressure: number;
    description: string;
    source: string;
    sourceLabel: string;
    officialSource: boolean;
  };
  hazard: {
    floodIndex: number;
    landslideIndex: number;
    earthquakeIndex: number;
    heatIndex: number;
    airQuality: number;
    source: string;
  };
  safety: ReturnType<typeof computeSafetyScore>;
  routeRisk: unknown;
  routeHazardRisk: unknown;
  nearestRouteNode: unknown;
  assessedAt: string;
  isLive: true;
}

export async function computeDestinationLive(
  destinationId: string,
  userId: string,
): Promise<LiveDestinationResult> {
  const isPrewarm = userId === "prewarm";
  const [destination, user, profileNotif, userHealth] = await Promise.all([
    prisma.destination.findUnique({ where: { id: destinationId } }),
    isPrewarm
      ? Promise.resolve(null)
      : prisma.user.findUnique({
          where: { id: userId },
          include: {
            homeLocation: {
              include: {
                district: {
                  include: { province: true },
                },
              },
            },
          },
        }),
    isPrewarm
      ? Promise.resolve(null)
      : prisma.notification.findFirst({
          where: {
            userId,
            message: { contains: '"_type":"PROFILE"' },
          },
        }),
    isPrewarm
      ? Promise.resolve(null)
      : prisma.userHealth.findUnique({
          where: { userId },
        }),
  ]);

  if (!destination) {
    throw new Error("Destination not found");
  }

  const profile = profileNotif && !isPrewarm ? JSON.parse(profileNotif.message) : null;
  const travelPurposes: string[] = profile?.travelPurposes ?? [];
  const healthFlags = userHealth ? buildHealthFlags(userHealth) : [];

  const weather = await fetchWeather(destination.latitude, destination.longitude);

  const liveWeather = {
    temperature: weather?.temperature ?? 18,
    humidity: weather?.humidity ?? 60,
    rainfall: weather?.rainfall ?? 0,
    windSpeed: weather?.windSpeed ?? 3,
    pressure: weather?.pressure ?? 1013,
    description: weather?.description ?? "fallback",
    source: weather?.source ?? "fallback",
    sourceLabel: weather?.sourceLabel ?? "Nepal estimate",
    officialSource: weather?.officialSource ?? false,
  };

  const hazard = await fetchHazard(destination.district, destination.latitude, destination.longitude);

  const liveHazard = {
    ...hazard,
    heatIndex: Math.max(0, Math.min((liveWeather.temperature - 25) / 20, 1)),
  };

  const safety = computeSafetyScore(
    liveWeather,
    liveHazard,
    ["SOLO", ...travelPurposes, ...healthFlags],
    "SOLO",
    liveWeather.source,
    {
      altitude: destination.altitude ?? null,
      districtName: destination.district,
      locationName: destination.name,
    },
  );

  const currentMonth = new Date().getMonth() + 1;
  const isMonsoon = currentMonth >= 6 && currentMonth <= 9;
  const purposes = [...travelPurposes, ...healthFlags];

  let routeRisk = null;
  let routeHazardRisk = null;

  const home = user?.homeLocation;

  if (!isPrewarm && home && home.latitude && home.longitude) {
    routeRisk = await assessRouteSegment(
      {
        locationId: home.id,
        locationName: home.name,
        district: home.district.name,
        province: home.district.province.name,
        lat: home.latitude,
        lon: home.longitude,
        altitude: home.altitude ?? null,
        arrivalDate: new Date().toISOString().split("T")[0],
        departureDate: new Date().toISOString().split("T")[0],
      },
      {
        locationId: destination.id,
        locationName: destination.name,
        district: destination.district,
        province: destination.province,
        lat: destination.latitude,
        lon: destination.longitude,
        altitude: destination.altitude ?? null,
        arrivalDate: new Date().toISOString().split("T")[0],
        departureDate: new Date().toISOString().split("T")[0],
      },
    ).catch(() => null);

    const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);
    const corridorDistrictLookup = buildCorridorLookup([
      { lat: home.latitude, lon: home.longitude, district: home.district.name },
      { lat: destination.latitude, lon: destination.longitude, district: destination.district },
    ]);

    routeHazardRisk = computeRouteRisk({
      originLat: home.latitude,
      originLon: home.longitude,
      originAlt: home.altitude ?? null,
      originDistrict: home.district.name,
      destLat: destination.latitude,
      destLon: destination.longitude,
      destAlt: destination.altitude ?? null,
      destDistrict: destination.district,
      isMonsoon,
      currentMonth,
      purposes,
      corridorDistrictLookup,
      historicDisasters,
      recentDisasters,
    });
  }

  const nearestRouteNode = await prisma.routeNode.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, latitude: true, longitude: true, isHub: true },
  });

  return {
    destination,
    weather: liveWeather,
    hazard: liveHazard,
    safety,
    routeRisk,
    routeHazardRisk,
    nearestRouteNode,
    assessedAt: new Date().toISOString(),
    isLive: true,
  };
}
