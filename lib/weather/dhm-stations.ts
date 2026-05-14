export interface DhmForecastStation {
  name: string;
  lat: number;
  lon: number;
}

export const DHM_FORECAST_STATIONS: DhmForecastStation[] = [
  { name: "Kathmandu", lat: 27.7172, lon: 85.3240 },
  { name: "Pokhara", lat: 28.2096, lon: 83.9856 },
  { name: "Jomsom", lat: 28.7800, lon: 83.7230 },
  { name: "Janakpur", lat: 26.7288, lon: 85.9260 },
  { name: "Dhankuta", lat: 26.9833, lon: 87.3333 },
  { name: "Okhaldhunga", lat: 27.3083, lon: 86.5000 },
  { name: "Jiri", lat: 27.6333, lon: 86.2333 },
  { name: "Taplejung", lat: 27.3540, lon: 87.6750 },
  { name: "Biratnagar", lat: 26.4525, lon: 87.2718 },
  { name: "Dharan", lat: 26.8144, lon: 87.2797 },
  { name: "Simara", lat: 27.1595, lon: 84.9802 },
  { name: "Bhairahawa", lat: 27.5057, lon: 83.4163 },
  { name: "Ghorahi", lat: 28.0300, lon: 82.4861 },
  { name: "Nepalgunj", lat: 28.0500, lon: 81.6167 },
  { name: "Birendranagar", lat: 28.6019, lon: 81.6339 },
  { name: "Jumla", lat: 29.2747, lon: 82.1838 },
  { name: "Dhangadi", lat: 28.6947, lon: 80.5936 },
  { name: "Dipayal", lat: 29.2581, lon: 80.9400 },
  { name: "Dadeldhura", lat: 29.2984, lon: 80.5830 },
];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const toRad = (degrees: number) => degrees * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function findNearestDhmStation(lat: number, lon: number) {
  return DHM_FORECAST_STATIONS.reduce((best, current) => {
    const bestDistance = haversineKm(lat, lon, best.lat, best.lon);
    const currentDistance = haversineKm(lat, lon, current.lat, current.lon);
    return currentDistance < bestDistance ? current : best;
  });
}
