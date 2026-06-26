#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PROVINCE_MAP: Record<string, string> = {
  "Province No. 1": "Koshi",
  "Province 1": "Koshi",
  "Koshi Province": "Koshi",
  "Madhesh Province": "Madhesh",
  "Madhesh": "Madhesh",
  "Bagmati Province": "Bagmati",
  "Bagamati Province": "Bagmati",
  "Gandaki Province": "Gandaki",
  "Lumbini Province": "Lumbini",
  "Karnali Province": "Karnali",
  "Sudurpashchim Province": "Sudurpashchim",
  "Sudurpashchim": "Sudurpashchim",
  "Nepal": "Unknown",
};

const NEPAL_DISTRICTS = new Set([
  "Achham", "Arghakhanchi", "Baglung", "Baitadi", "Bajhang", "Bajura",
  "Banke", "Bara", "Bardiya", "Bhaktapur", "Bhojpur", "Chitwan",
  "Dadeldhura", "Dailekh", "Dang", "Darchula", "Dhading", "Dhankuta",
  "Dhanusha", "Dolakha", "Dolpa", "Doti", "Gorkha", "Gulmi",
  "Humla", "Ilam", "Jajarkot", "Jhapa", "Jumla", "Kailali",
  "Kalikot", "Kanchanpur", "Kapilvastu", "Kaski", "Kathmandu",
  "Kavrepalanchok", "Khotang", "Lalitpur", "Lamjung", "Mahottari",
  "Makwanpur", "Manang", "Morang", "Mugu", "Mustang", "Myagdi",
  "Nawalparasi", "Nawalpur", "Nuwakot", "Okhaldhunga", "Palpa",
  "Panchthar", "Parbat", "Parsa", "Pyuthan", "Ramechhap", "Rasuwa",
  "Rautahat", "Rolpa", "Rukum", "Rukum East", "Rukum West",
  "Rupandehi", "Salyan", "Sankhuwasabha", "Saptari", "Sarlahi",
  "Sindhuli", "Sindhupalchok", "Siraha", "Solukhumbu", "Sunsari",
  "Surkhet", "Syangja", "Tanahu", "Tanahun", "Taplejung",
  "Terhathum", "Udayapur",
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-\s]/g, "").replace(/[.,]/g, "");
}

function matchDistrict(candidate: string): string | null {
  const nc = normalize(candidate);
  for (const d of NEPAL_DISTRICTS) {
    if (normalize(d) === nc) return d;
  }
  for (const d of NEPAL_DISTRICTS) {
    if (nc.includes(normalize(d)) || normalize(d).includes(nc)) return d;
  }
  return null;
}

async function reverseGeocode(lat: number, lon: number): Promise<{ district: string; province: string } | null> {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon),
    format: "jsonv2", zoom: "10", addressdetails: "1",
  });
  try {
    const baseUrl = process.env.NOMINATIM_URL || process.env.NEXT_PUBLIC_NOMINATIM_URL || "https://nominatim.openstreetmap.org";
    const res = await fetch(`${baseUrl}/reverse?${params}`, {
      headers: { "User-Agent": "YatraAI/1.0 (district-enrichment)", "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data?.address) return null;
    const addr = data.address;
    const rawDistrict = addr.state_district || addr.county || addr.city_district || "";
    const rawProvince = addr.state || addr.region || "";
    const district = matchDistrict(rawDistrict) || "Unknown";
    const province = PROVINCE_MAP[rawProvince] || rawProvince || "Unknown";
    return { district, province };
  } catch {
    return null;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const inputPath = join(__dirname, "data", "destinations.json");
  const data = JSON.parse(readFileSync(inputPath, "utf-8"));
  const dests = data.destinations as any[];
  console.log(`Total: ${dests.length}`);

  const unknown = dests.filter((d: any) =>
    d.district === "Unknown" || d.district === "unknown" || !d.district
  );
  console.log(`Unknown district: ${unknown.length}`);

  let updated = 0;
  for (let i = 0; i < unknown.length; i++) {
    const d = unknown[i];
    process.stdout.write(`[${i + 1}/${unknown.length}] ${d.name} (${d.latitude}, ${d.longitude})... `);
    const result = await reverseGeocode(d.latitude, d.longitude);
    if (result && result.district !== "Unknown") {
      d.district = result.district;
      d.province = result.province;
      updated++;
      console.log(`→ ${result.district} / ${result.province}`);
    } else {
      console.log(`❌ no match`);
    }
    await sleep(1100);
  }

  // Also update province for known districts if missing
  const noProvince = dests.filter((d: any) =>
    d.district !== "Unknown" && (!d.province || d.province === "Unknown")
  );
  console.log(`\nKnown district but no province: ${noProvince.length}`);

  data.count = dests.length;
  data.updatedAt = new Date().toISOString();
  writeFileSync(inputPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\nDone. Updated: ${updated}, Total: ${dests.length}`);
  console.log(`Saved to: ${inputPath}`);
}

main().catch(console.error);
