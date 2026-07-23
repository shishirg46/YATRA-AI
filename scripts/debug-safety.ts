import { computeSafetyScore } from "../lib/scoring/safety";

const baseWeather = { temperature: 20, humidity: 60, rainfall: 0, windSpeed: 5, pressure: 1013 };
const baseHazard = { floodIndex: 0, landslideIndex: 0, earthquakeIndex: 0, stormIndex: 0, accidentIndex: 0, heatIndex: 0, airQuality: 0 };

function show(alt: number, district: string, name: string) {
  const r = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", { altitude: alt, districtName: district, locationName: name });
  console.log(`Alt ${alt} -> penalties:`, r.decisionTrace.penalties);
}

show(5500, 'solukhumbu', 'Everest Base Camp');
show(4500, 'solukhumbu', 'EBC');
show(3500, 'kaski', 'Annapurna Base Camp');
show(2500, 'kaski', 'Pokhara');
show(1500, 'kaski', 'Pokhara');

const hazards = { floodIndex: 0.8, landslideIndex: 0, earthquakeIndex: 0, stormIndex: 0, accidentIndex: 0, heatIndex: 0, airQuality: 0 };
const floodRes = computeSafetyScore(baseWeather, hazards, ["TOURISM"], "live", "live", { altitude: 500, districtName: 'bara', locationName: 'Bara' });
console.log('Flood penalties:', floodRes.decisionTrace.penalties);

// heavy rain + altitude
function levelFor(alt: number, rainfall: number) {
  const w = { ...baseWeather, rainfall };
  const r = computeSafetyScore(w, baseHazard, ["TOURISM"], "live", "live", { altitude: alt, districtName: 'kaski', locationName: 'Test' });
  console.log(`Alt ${alt} Rain ${rainfall} -> score ${r.safetyScore} level ${r.safetyLevel} penalties:`, r.decisionTrace.penalties);
}

levelFor(4000, 100);

console.log('Done');
