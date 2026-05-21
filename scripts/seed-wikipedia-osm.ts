#!/usr/bin/env node
/**
 * scripts/seed-wikipedia-osm.ts
 *
 * Fetches Nepal tourism destinations from OSM, filtered by Wikipedia listing.
 * Only tourism/hiking/trekking/mountaineering places — no hotels, toilets, hospitals.
 *
 * Run: npx tsx scripts/seed-wikipedia-osm.ts
 */

import "dotenv/config";
import { PrismaClient, DestinationCategory, DestinationSource } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as v from "../lib/destinations/validation";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const OVERPASS_URL = "https://overpass.openstreetmap.fr/api/interpreter";
const UA = "YatraAI/1.0 (wikipedia-osm-seed)";

const NEPAL_BBOX = "26.3,80.0,30.5,88.2";

// Wikipedia-sourced reference list of known tourism destinations in Nepal.
// These are the ONLY places that will be seeded.
// Sources: List of tourist attractions in Nepal, World Heritage Sites,
// National parks, Mountains, Lakes, Temples, Trekking routes, etc.
const WIKIPEDIA_DESTINATIONS: Array<{ name: string; wikiCategory: string }> = [
  // ── UNESCO World Heritage Sites ──
  { name: "Kathmandu Durbar Square", wikiCategory: "cultural" },
  { name: "Patan Durbar Square", wikiCategory: "cultural" },
  { name: "Bhaktapur Durbar Square", wikiCategory: "cultural" },
  { name: "Swayambhunath", wikiCategory: "cultural" },
  { name: "Boudhanath", wikiCategory: "cultural" },
  { name: "Pashupatinath Temple", wikiCategory: "cultural" },
  { name: "Changu Narayan", wikiCategory: "cultural" },
  { name: "Lumbini", wikiCategory: "cultural" },
  { name: "Sagarmatha National Park", wikiCategory: "trekking" },
  { name: "Chitwan National Park", wikiCategory: "trekking" },
  { name: "Mount Everest", wikiCategory: "nature" },

  // ── Major Trekking Peaks ──
  { name: "Ama Dablam", wikiCategory: "nature" },
  { name: "Annapurna", wikiCategory: "nature" },
  { name: "Annapurna I", wikiCategory: "nature" },
  { name: "Annapurna II", wikiCategory: "nature" },
  { name: "Annapurna III", wikiCategory: "nature" },
  { name: "Annapurna IV", wikiCategory: "nature" },
  { name: "Annapurna South", wikiCategory: "nature" },
  { name: "Manaslu", wikiCategory: "nature" },
  { name: "Kanchenjunga", wikiCategory: "nature" },
  { name: "Dhaulagiri", wikiCategory: "nature" },
  { name: "Dhaulagiri II", wikiCategory: "nature" },
  { name: "Makalu", wikiCategory: "nature" },
  { name: "Langtang Lirung", wikiCategory: "nature" },
  { name: "Machapuchare", wikiCategory: "nature" },
  { name: "Pumori", wikiCategory: "nature" },
  { name: "Nuptse", wikiCategory: "nature" },
  { name: "Lhotse", wikiCategory: "nature" },
  { name: "Cho Oyu", wikiCategory: "nature" },
  { name: "Gyachung Kang", wikiCategory: "nature" },
  { name: "Himlung Himal", wikiCategory: "nature" },
  { name: "Api", wikiCategory: "nature" },
  { name: "Saipal", wikiCategory: "nature" },
  { name: "Gaurishankar", wikiCategory: "nature" },
  { name: "Dorje Lakpa", wikiCategory: "nature" },
  { name: "Melungtse", wikiCategory: "nature" },
  { name: "Kubi Gangri", wikiCategory: "nature" },
  { name: "Yalung Kang", wikiCategory: "nature" },
  { name: "Kirat Chuli", wikiCategory: "nature" },
  { name: "Jannu", wikiCategory: "nature" },
  { name: "Kabru", wikiCategory: "nature" },
  { name: "Kangchenjunga West", wikiCategory: "nature" },
  { name: "Mera Peak", wikiCategory: "nature" },
  { name: "Island Peak", wikiCategory: "nature" },
  { name: "Lobuche East", wikiCategory: "nature" },
  { name: "Lobuche West", wikiCategory: "nature" },
  { name: "Tharpu Chuli", wikiCategory: "nature" },
  { name: "Nilgiri", wikiCategory: "nature" },
  { name: "Annapurna Massif", wikiCategory: "nature" },
  { name: "Kusum Kangguru", wikiCategory: "nature" },
  { name: "Cholatse", wikiCategory: "nature" },
  { name: "Taboche", wikiCategory: "nature" },
  { name: "Tent Peak", wikiCategory: "nature" },
  { name: "Singu Chuli", wikiCategory: "nature" },
  { name: "Hiunchuli", wikiCategory: "nature" },
  { name: "Gangapurna", wikiCategory: "nature" },
  { name: "Tukuche Peak", wikiCategory: "nature" },
  { name: "Dhampus Peak", wikiCategory: "nature" },
  { name: "Langshisha Ri", wikiCategory: "nature" },
  { name: "Pisang Peak", wikiCategory: "nature" },
  { name: "Chulu West", wikiCategory: "nature" },
  { name: "Chulu East", wikiCategory: "nature" },
  { name: "Singu Chuli", wikiCategory: "nature" },
  { name: "Ganesh Himal", wikiCategory: "nature" },
  { name: "Shishapangma", wikiCategory: "nature" },

  // ── National Parks & Protected Areas ──
  { name: "Langtang National Park", wikiCategory: "trekking" },
  { name: "Makalu Barun National Park", wikiCategory: "trekking" },
  { name: "Shey Phoksundo National Park", wikiCategory: "trekking" },
  { name: "Bardia National Park", wikiCategory: "trekking" },
  { name: "Khaptad National Park", wikiCategory: "trekking" },
  { name: "Rara National Park", wikiCategory: "trekking" },
  { name: "Annapurna Conservation Area", wikiCategory: "trekking" },
  { name: "Kanchenjunga Conservation Area", wikiCategory: "trekking" },
  { name: "Manaslu Conservation Area", wikiCategory: "trekking" },
  { name: "Shivapuri Nagarjun National Park", wikiCategory: "trekking" },
  { name: "Banke National Park", wikiCategory: "trekking" },
  { name: "Parsa National Park", wikiCategory: "trekking" },
  { name: "Suklaphanta National Park", wikiCategory: "trekking" },
  { name: "Koshi Tappu Wildlife Reserve", wikiCategory: "trekking" },
  { name: "Ghodaghodi Lake", wikiCategory: "nature" },
  { name: "Dhorpatan Hunting Reserve", wikiCategory: "trekking" },
  { name: "Api Nampa Conservation Area", wikiCategory: "trekking" },
  { name: "Gaurishankar Conservation Area", wikiCategory: "trekking" },
  { name: "Krishnasar Conservation Area", wikiCategory: "trekking" },
  { name: "Blackbuck Conservation Area", wikiCategory: "trekking" },

  // ── Major Lakes ──
  { name: "Phewa Lake", wikiCategory: "nature" },
  { name: "Tilicho Lake", wikiCategory: "nature" },
  { name: "Gokyo Lakes", wikiCategory: "nature" },
  { name: "Shey Phoksundo Lake", wikiCategory: "nature" },
  { name: "Begnas Lake", wikiCategory: "nature" },
  { name: "Rara Lake", wikiCategory: "nature" },
  { name: "Fewa Lake", wikiCategory: "nature" },
  { name: "Gokyo Lake", wikiCategory: "nature" },
  { name: "Panch Pokhari", wikiCategory: "nature" },
  { name: "Mai Pokhari", wikiCategory: "nature" },
  { name: "Khaste Lake", wikiCategory: "nature" },
  { name: "Dipang Lake", wikiCategory: "nature" },
  { name: "Kamal Pokhari", wikiCategory: "nature" },
  { name: "Bishahari Lake", wikiCategory: "nature" },

  // ── Famous Temples & Monasteries ──
  { name: "Muktinath", wikiCategory: "cultural" },
  { name: "Tengboche Monastery", wikiCategory: "cultural" },
  { name: "Manakamana Temple", wikiCategory: "cultural" },
  { name: "Dakshinkali Temple", wikiCategory: "cultural" },
  { name: "Taleju Temple", wikiCategory: "cultural" },
  { name: "Nyatapola Temple", wikiCategory: "cultural" },
  { name: "Kasthamandap", wikiCategory: "cultural" },
  { name: "Bhadrakali Temple", wikiCategory: "cultural" },
  { name: "Bhairavnath Temple", wikiCategory: "cultural" },
  { name: "Chinnamasta Bhagawati Temple", wikiCategory: "cultural" },
  { name: "Pathibhara Devi Temple", wikiCategory: "cultural" },
  { name: "Kopila Mata Temple", wikiCategory: "cultural" },
  { name: "Kumbheshwar Temple", wikiCategory: "cultural" },
  { name: "Mata Bhawani Temple", wikiCategory: "cultural" },
  { name: "Muktinath Temple", wikiCategory: "cultural" },
  { name: "Bindabasini Temple", wikiCategory: "cultural" },
  { name: "Guhyeshwari Temple", wikiCategory: "cultural" },
  { name: "Swayambhunath Stupa", wikiCategory: "cultural" },
  { name: "Boudhanath Stupa", wikiCategory: "cultural" },
  { name: "Swoyambhu Mahachaitya", wikiCategory: "cultural" },
  { name: "Patan Museum", wikiCategory: "cultural" },
  { name: "Hanuman Dhoka Palace", wikiCategory: "cultural" },
  { name: "Jana Bahal", wikiCategory: "cultural" },
  { name: "Sahid Gate", wikiCategory: "cultural" },

  // ── Trekking Routes & Destinations ──
  { name: "Annapurna Circuit", wikiCategory: "trekking" },
  { name: "Annapurna Base Camp", wikiCategory: "trekking" },
  { name: "Everest Base Camp", wikiCategory: "trekking" },
  { name: "Langtang Valley Trek", wikiCategory: "trekking" },
  { name: "Manaslu Circuit Trek", wikiCategory: "trekking" },
  { name: "Kanchenjunga Base Camp Trek", wikiCategory: "trekking" },
  { name: "Mustang Trek", wikiCategory: "trekking" },
  { name: "Dolpo Trek", wikiCategory: "trekking" },
  { name: "Great Himalaya Trail", wikiCategory: "trekking" },
  { name: "Nar Phu Valley Trek", wikiCategory: "trekking" },
  { name: "Tsum Valley Trek", wikiCategory: "trekking" },

  // ── Hill Stations & Viewpoints ──
  { name: "Nagarkot", wikiCategory: "nature" },
  { name: "Sarangkot", wikiCategory: "nature" },
  { name: "Dhulikhel", wikiCategory: "nature" },
  { name: "Kakani", wikiCategory: "nature" },
  { name: "Nagarjun Forest", wikiCategory: "nature" },
  { name: "Shivapuri Hill", wikiCategory: "nature" },
  { name: "Phulchowki", wikiCategory: "nature" },
  { name: "Chandragiri Hill", wikiCategory: "nature" },
  { name: "Jamacho Hill", wikiCategory: "nature" },
  { name: "Kahun Danda", wikiCategory: "nature" },

  // ── Valleys ──
  { name: "Kathmandu Valley", wikiCategory: "cultural" },
  { name: "Pokhara Valley", wikiCategory: "nature" },
  { name: "Kali Gandaki Valley", wikiCategory: "nature" },
  { name: "Kathmandu", wikiCategory: "cultural" },
  { name: "Bhaktapur", wikiCategory: "cultural" },
  { name: "Patan", wikiCategory: "cultural" },
  { name: "Kirtipur", wikiCategory: "cultural" },
  { name: "Budhanilkantha", wikiCategory: "cultural" },
  { name: "Thankot", wikiCategory: "nature" },
  { name: "Bharatpur", wikiCategory: "cultural" },
  { name: "Hetauda", wikiCategory: "cultural" },
  { name: "Biratnagar", wikiCategory: "cultural" },
  { name: "Janakpur", wikiCategory: "cultural" },
  { name: "Nepalgunj", wikiCategory: "cultural" },
  { name: "Pokhara", wikiCategory: "cultural" },

  // ── Destinations from tourism categories ──
  { name: "Ghandruk", wikiCategory: "trekking" },
  { name: "Bandipur", wikiCategory: "cultural" },
  { name: "Tansen", wikiCategory: "cultural" },
  { name: "Nuwakot", wikiCategory: "cultural" },
  { name: "Panauti", wikiCategory: "cultural" },
  { name: "Namche Bazaar", wikiCategory: "trekking" },
  { name: "Lukla", wikiCategory: "trekking" },
  { name: "Jomsom", wikiCategory: "trekking" },
  { name: "Marpha", wikiCategory: "trekking" },
  { name: "Kagbeni", wikiCategory: "trekking" },
  { name: "Muktinath Valley", wikiCategory: "trekking" },
  { name: "Lo Manthang", wikiCategory: "trekking" },
  { name: "Gokyo", wikiCategory: "trekking" },
  { name: "Tengboche", wikiCategory: "trekking" },
  { name: "Pheriche", wikiCategory: "trekking" },
  { name: "Gorak Shep", wikiCategory: "trekking" },
  { name: "Dhampus", wikiCategory: "trekking" },
  { name: "Poon Hill", wikiCategory: "trekking" },
  { name: "Ghorepani", wikiCategory: "trekking" },
  { name: "Tadapani", wikiCategory: "trekking" },
  { name: "Chhomrong", wikiCategory: "trekking" },
  { name: "Sinuwa", wikiCategory: "trekking" },
  { name: "Dovan", wikiCategory: "trekking" },
  { name: "Himalaya", wikiCategory: "trekking" },
  { name: "Deurali", wikiCategory: "trekking" },
  { name: "MBC", wikiCategory: "trekking" },
  { name: "ABC", wikiCategory: "trekking" },
  { name: "Ghasa", wikiCategory: "trekking" },
  { name: "Tatopani", wikiCategory: "trekking" },
  { name: "Beni", wikiCategory: "trekking" },
  { name: "Dana", wikiCategory: "trekking" },
  { name: "Rupse Falls", wikiCategory: "nature" },
  { name: "Rani Mahal", wikiCategory: "cultural" },
  { name: "Swargadwari", wikiCategory: "cultural" },
  { name: "Bageshwari Temple", wikiCategory: "cultural" },
  { name: "Gadhi Mai Temple", wikiCategory: "cultural" },
  { name: "Bharatpur", wikiCategory: "cultural" },
  { name: "Baraha Kshetra", wikiCategory: "cultural" },
  { name: "Halesi Mahadev", wikiCategory: "cultural" },
  { name: "Pathivara Temple", wikiCategory: "cultural" },
  { name: "Kanyam", wikiCategory: "nature" },
  { name: "Ilam", wikiCategory: "nature" },
  { name: "Gupa Pokhari", wikiCategory: "nature" },
  { name: "Mai Pokhari", wikiCategory: "nature" },
  { name: "Kalinchowk", wikiCategory: "nature" },
  { name: "Dolakha", wikiCategory: "cultural" },
  { name: "Sailung", wikiCategory: "nature" },
  { name: "Kurmarwan", wikiCategory: "nature" },
  { name: "Dolakha Bhimsen Temple", wikiCategory: "cultural" },
  { name: "Jiri", wikiCategory: "trekking" },
  { name: "Salleri", wikiCategory: "trekking" },
  { name: "Thamserku", wikiCategory: "nature" },
  { name: "Kusma", wikiCategory: "nature" },
  { name: "Ramdi", wikiCategory: "cultural" },
  { name: "Seti Gandaki", wikiCategory: "nature" },
  { name: "Begnas", wikiCategory: "nature" },
  { name: "Rupa Lake", wikiCategory: "nature" },
  { name: "Mahendra Cave", wikiCategory: "nature" },
  { name: "Bat Cave", wikiCategory: "nature" },
  { name: "Gupteshwor Cave", wikiCategory: "nature" },
  { name: "Devi's Fall", wikiCategory: "nature" },
  { name: "Sarangkot Viewpoint", wikiCategory: "nature" },
  { name: "World Peace Pagoda", wikiCategory: "cultural" },
  { name: "Gurkha Memorial Park", wikiCategory: "cultural" },
  { name: "Dharapani", wikiCategory: "trekking" },
  { name: "Bagarchhap", wikiCategory: "trekking" },
  { name: "Chame", wikiCategory: "trekking" },
  { name: "Pisang", wikiCategory: "trekking" },
  { name: "Bhratang", wikiCategory: "trekking" },
  { name: "Manang", wikiCategory: "trekking" },
  { name: "Thorung Phedi", wikiCategory: "trekking" },
  { name: "Muktinath Phedi", wikiCategory: "trekking" },
  { name: "Charikot", wikiCategory: "nature" },
  { name: "Besishahar", wikiCategory: "trekking" },
  { name: "Besisahar", wikiCategory: "trekking" },
  { name: "Syanje", wikiCategory: "trekking" },
  { name: "Jagat", wikiCategory: "trekking" },
  { name: "Dharapani", wikiCategory: "trekking" },
  { name: "Taal", wikiCategory: "trekking" },
  { name: "Koto", wikiCategory: "trekking" },
  { name: "Syaphrubesi", wikiCategory: "trekking" },
  { name: "Lama Hotel", wikiCategory: "trekking" },
  { name: "Rimche", wikiCategory: "trekking" },
  { name: "Thulo Syabru", wikiCategory: "trekking" },
  { name: "Sing Gompa", wikiCategory: "trekking" },
  { name: "Kyanjin Gompa", wikiCategory: "trekking" },
  { name: "Chisapani", wikiCategory: "trekking" },
  { name: "Mangengoth", wikiCategory: "trekking" },
  { name: "Bamboo", wikiCategory: "trekking" },
];

// Map OSM tourism tags that are acceptable (no hotels/toilets/hospitals)
const TOURISM_TAGS = new Set([
  "viewpoint", "camp_site", "alpine_hut", "attraction", "museum",
  "gallery", "wilderness_hut", "information", "theme_park", "zoo",
]);

const NATURE_TAGS = new Set([
  "peak", "volcano", "cliff", "valley", "ridge", "lake", "water",
  "wood", "forest", "waterfall", "cave_entrance", "hot_spring",
  "glacier", "rock", "stone", "scree", "sand", "mud", "geyser",
  "spring", "bay", "strait",
]);

const HISTORIC_TAGS = new Set([
  "monument", "memorial", "archaeological_site", "castle", "fort",
  "ruins", "palace", "tower", "wayside_shrine", "wayside_cross",
  "city_gate", "battlefield",
]);

const CULTURAL_TAGS = new Set([
  "place_of_worship", "monastery", "temple", "church", "chapel",
  "cathedral", "mosque", "shrine", "gurdwara",
]);

const LEISURE_TAGS = new Set([
  "park", "garden", "nature_reserve", "marina", "pitch",
  "stadium", "playground", "track", "common",
]);

const BOUNDARY_TAGS = new Set([
  "national_park", "protected_area", "conservation_area",
]);

function isTourismRelevant(tags: Record<string, string>): boolean {
  for (const key of ["tourism", "natural", "historic", "leisure", "boundary", "amenity"]) {
    const val = tags[key];
    if (!val) continue;
    if (key === "tourism" && TOURISM_TAGS.has(val)) return true;
    if (key === "natural" && NATURE_TAGS.has(val)) return true;
    if (key === "historic" && HISTORIC_TAGS.has(val)) return true;
    if (key === "leisure" && LEISURE_TAGS.has(val)) return true;
    if (key === "boundary" && BOUNDARY_TAGS.has(val)) return true;
    if (key === "amenity" && CULTURAL_TAGS.has(val)) return true;
  }
  if (tags.route === "hiking" || tags.route === "trekking") return true;
  return false;
}

function mapCategory(name: string, tags: Record<string, string>): DestinationCategory {
  for (const key of ["tourism", "natural", "historic", "leisure", "boundary", "amenity"] as const) {
    const val = tags[key];
    if (!val) continue;
    if (key === "natural" && (val === "peak" || val === "volcano" || val === "glacier")) return "MOUNTAIN";
    if (key === "natural" && (val === "lake" || val === "water")) return "LAKE";
    if (key === "natural" && val === "waterfall") return "WATERFALL";
    if (key === "natural" && (val === "wood" || val === "forest")) return "FOREST";
    if (key === "natural" && val === "cave_entrance") return "OTHER";
    if (key === "natural" && val === "hot_spring") return "RIVERSIDE";
    if (key === "natural" && val === "valley") return "VIEWPOINT";
    if (key === "natural" && val === "ridge") return "VIEWPOINT";
    if (key === "tourism" && val === "viewpoint") return "VIEWPOINT";
    if (key === "tourism" && (val === "camp_site" || val === "alpine_hut" || val === "wilderness_hut")) return "CAMP";
    if (key === "tourism" && (val === "attraction" || val === "museum" || val === "gallery" || val === "theme_park" || val === "zoo")) return "TOURIST_ATTRACTION";
    if (key === "historic" && (val === "castle" || val === "fort" || val === "palace" || val === "archaeological_site")) return "TEMPLE";
    if (key === "historic" && (val === "monument" || val === "memorial" || val === "tower")) return "TOURIST_ATTRACTION";
    if (key === "amenity" && val === "place_of_worship") return "TEMPLE";
    if (key === "leisure" && val === "park") return "FOREST";
    if (key === "leisure" && val === "garden") return "TOURIST_ATTRACTION";
    if (key === "boundary" && (val === "national_park" || val === "protected_area")) return "FOREST";
    if (key === "boundary" && val === "conservation_area") return "FOREST";
  }

  const l = name.toLowerCase();
  if (/lake|tal|pokhari|sagar|kunda|daha/i.test(l)) return "LAKE";
  if (/waterfall|falls|jharna|chhaang/i.test(l)) return "WATERFALL";
  if (/peak|mount|him|giri|shikhar|chuli|everest/i.test(l)) return "MOUNTAIN";
  if (/hill|pahar|danda|lek/i.test(l)) return "HILL";
  if (/temple|mandir|monastery|gompa|stupa|church|mosque|shrine|gumba/i.test(l)) return "TEMPLE";
  if (/park|forest|ban|conservation|reserve|protected/i.test(l)) return "FOREST";
  if (/viewpoint|view|danda|deurali|observation/i.test(l)) return "VIEWPOINT";
  if (/trek|trail|circuit|base.?camp|camp/i.test(l)) return "CAMP";
  if (/village|gaon|basti|bazaar|bazar|settlement/i.test(l)) return "TREKKING_VILLAGE";
  if (/palace|durbar|fort|museum|monument|square|garden|bridge/i.test(l)) return "TOURIST_ATTRACTION";
  if (/valley/i.test(l)) return "VIEWPOINT";
  if (/cave/i.test(l)) return "OTHER";

  return "TOURIST_ATTRACTION";
}

function isGeneric(name: string): boolean {
  const t = name.trim();
  if (t.length < 3) return true;
  const patterns = [
    /^(unknown|unnamed|none|n\/a|place|location|point|spot)$/i,
    /^(view|scenic|photo)$/i,
    /^(restaurant|cafe|hotel|lodge|guest\s?house|homestay|hostel|toilet|hospital|clinic|pharmacy)$/i,
    /^(temple|monastery|gompa|church|mosque)$/i,
    /^(peak|hill|mount|mountain|lake|river|waterfall|forest|park)$/i,
    /^(village|town|city|hamlet|settlement|locality)$/i,
    /^[0-9]+$/,
  ];
  return patterns.some((p) => p.test(t));
}

const WIKI_NAME_INDEX = new Map<string, string>();
for (const d of WIKIPEDIA_DESTINATIONS) {
  const key = v.normalizeName(d.name);
  if (!WIKI_NAME_INDEX.has(key)) {
    WIKI_NAME_INDEX.set(key, d.wikiCategory);
  }
}

const WIKI_NAME_SET = new Set(WIKI_NAME_INDEX.keys());

function isInWikipedia(name: string): boolean {
  const normalized = v.normalizeName(name);
  if (WIKI_NAME_SET.has(normalized)) return true;
  for (const key of WIKI_NAME_SET) {
    if (normalized.includes(key) || key.includes(normalized)) return true;
    const dist = levenshtein(normalized, key);
    const maxLen = Math.max(normalized.length, key.length);
    if (dist / maxLen < 0.2) return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findProvince(lat: number, lon: number): string {
  if (lat >= 29.5) return "Sudurpashchim";
  if (lat >= 28.8) return lon >= 83.5 ? "Karnali" : "Sudurpashchim";
  if (lat >= 28.0) return lon >= 84.5 ? "Gandaki" : "Karnali";
  if (lat >= 27.5) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lat >= 27.0) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lon >= 86.5) return "Koshi";
  if (lon >= 85.0) return "Bagmati";
  if (lon >= 84.0) return "Madhesh";
  return "Lumbini";
}

async function queryOverpass(query: string): Promise<any[]> {
  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": UA },
    body: query,
    signal: AbortSignal.timeout(180000),
  });
  if (!resp.ok) throw new Error(`Overpass ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  return ((await resp.json()) as { elements: any[] }).elements ?? [];
}

interface OsmPlace {
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  osmId: string;
  category: DestinationCategory;
  tags: Record<string, string>;
}

async function fetchTourismPlaces(): Promise<OsmPlace[]> {
  const queries = [
    // Viewpoints, camp sites, alpine huts, attractions
    `[out:json][timeout:180];(node["tourism"~"viewpoint|camp_site|alpine_hut|attraction|museum|gallery|wilderness_hut|theme_park"](${NEPAL_BBOX});way["tourism"~"viewpoint|camp_site|alpine_hut|attraction|museum|gallery|wilderness_hut|theme_park"](${NEPAL_BBOX}););out center;`,
    // Natural peaks, lakes, waterfalls, valleys, caves, hot springs
    `[out:json][timeout:180];(node["natural"~"peak|volcano|cliff|valley|ridge|lake|water|waterfall|cave_entrance|hot_spring|glacier"](${NEPAL_BBOX});way["natural"~"peak|volcano|cliff|valley|ridge|lake|water|waterfall|cave_entrance|hot_spring|glacier"](${NEPAL_BBOX}););out center;`,
    // Historic monuments, archaeological sites, castles, forts, ruins
    `[out:json][timeout:180];(node["historic"~"monument|memorial|archaeological_site|castle|fort|ruins|palace|tower"](${NEPAL_BBOX});way["historic"~"monument|memorial|archaeological_site|castle|fort|ruins|palace|tower"](${NEPAL_BBOX}););out center;`,
    // National parks, protected areas
    `[out:json][timeout:180];(node["boundary"~"national_park|protected_area"](${NEPAL_BBOX});way["boundary"~"national_park|protected_area"](${NEPAL_BBOX});rel["boundary"~"national_park|protected_area"](${NEPAL_BBOX}););out center;`,
    // Temples, monasteries, places of worship
    `[out:json][timeout:180];(node["amenity"="place_of_worship"](${NEPAL_BBOX});way["amenity"="place_of_worship"](${NEPAL_BBOX}););out center;`,
    // Leisure parks, gardens, nature reserves
    `[out:json][timeout:180];(node["leisure"~"park|garden|nature_reserve"](${NEPAL_BBOX});way["leisure"~"park|garden|nature_reserve"](${NEPAL_BBOX}););out center;`,
    // Hiking routes
    `[out:json][timeout:180];(way["route"="hiking"](${NEPAL_BBOX});way["route"="trekking"](${NEPAL_BBOX}););out center;`,
  ];

  const all: OsmPlace[] = [];
  const seenOsmId = new Set<string>();

  for (let qi = 0; qi < queries.length; qi++) {
    console.log(`  Query ${qi + 1}/${queries.length}...`);
    try {
      const elements = await queryOverpass(queries[qi]);
      for (const el of elements) {
        const tags = el.tags ?? {};
        let lat: number, lon: number;
        if (el.type === "node") {
          lat = el.lat; lon = el.lon;
        } else {
          const c = el.center;
          if (!c) continue;
          lat = c.lat; lon = c.lon;
        }

        const name = tags.name ?? tags["name:en"] ?? "";
        const altNames = [
          tags["name:en"], tags["name:ne"], tags["alt_name"],
          tags["official_name"], tags["name:hi"],
        ].filter(Boolean);
        const allNames = [name, ...altNames, tags.name ?? ""].filter(Boolean);
        const uniqueNames = [...new Set(allNames.map((n) => v.normalizeName(n)))];

        const primaryName = uniqueNames[0] || name;
        if (!primaryName || isGeneric(primaryName)) continue;
        if (!isTourismRelevant(tags)) continue;

        const osmId = `${el.type}/${el.id}`;
        if (seenOsmId.has(osmId)) continue;
        seenOsmId.add(osmId);

        const matchesWikipedia = uniqueNames.some((n) => isInWikipedia(n));
        if (!matchesWikipedia) continue;

        all.push({
          name: primaryName,
          lat,
          lon,
          ele: tags.ele ? parseFloat(tags.ele) : null,
          osmId,
          category: mapCategory(primaryName, tags),
          tags,
        });
      }
      console.log(`    → ${elements.length} elements, ${all.length} Wikipedia-matched so far`);
    } catch (err) {
      console.error(`    ✗ Query ${qi + 1} failed:`, err);
    }
    if (qi < queries.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  return all;
}

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  🏔️  WIKIPEDIA-REFERENCED OSM DESTINATION SEED   ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`📋 Wikipedia reference list: ${WIKIPEDIA_DESTINATIONS.length} destinations`);
  console.log();

  // Step 1: Fetch all tourism-relevant OSM elements in Nepal
  console.log("🌐 Fetching tourism places from OSM Overpass...");
  console.log("─".repeat(50));
  const places = await fetchTourismPlaces();
  console.log(`\n✅ Found ${places.length} Wikipedia-matched places in OSM\n`);

  // Step 2: Dedup by name similarity
  console.log("🔍 Deduplicating...");
  const deduped: OsmPlace[] = [];
  const seenNames = new Set<string>();
  for (const p of places) {
    const key = v.normalizeName(p.name);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deduped.push(p);
  }
  console.log(`  ${places.length} → ${deduped.length} after dedup\n`);

  // Step 3: Extract district/province from OSM tags, fallback to coordinate inference
  console.log("📍 Resolving district/province...");
  let enriched = 0;
  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];
    const t = p.tags;
    const district = t["addr:district"] || t["addr:county"] || t["is_in:district"] || t["is_in"] || null;
    const province = t["addr:province"] || t["is_in:province"] || t["addr:state"] || null;
    (p as any)._district = district || null;
    (p as any)._province = province || null;
    if (district || province) enriched++;
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${deduped.length} resolved`);
  }
  console.log(`  ✅ ${enriched}/${deduped.length} with tags, rest use coordinate inference\n`);

  // Step 4: Seed into database
  console.log("💾 Seeding into database...");
  console.log("─".repeat(50));
  let created = 0;
  let updated = 0;
  let skipped = 0;

  let skippedQuality = 0;

  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];
    const district = (p as any)._district || findProvince(p.lat, p.lon);
    const province = (p as any)._province || findProvince(p.lat, p.lon);
    const coordCheck = v.validateCoordinates(p.lat, p.lon, false);

    // Quality filters
    if (p.name.length < 4) { skippedQuality++; continue; }
    if (!p.lat || !p.lon || !coordCheck.valid) { skippedQuality++; continue; }
    if (p.category === "OTHER" && !p.tags.wikipedia && !p.tags.wikidata) { skippedQuality++; continue; }

    const qualityFactors: v.DataQualityFactors = {
      hasName: true,
      hasCoordinates: true,
      coordinatesValid: coordCheck.valid,
      coordinatesInNepal: coordCheck.inNepal,
      hasAltitude: p.ele !== null && p.ele > 0,
      hasCategory: p.category !== "OTHER",
      hasDescription: !!p.tags.description,
      hasVerification: true,
      hasSource: true,
    };
    const qualityScore = v.calculateQualityScore(qualityFactors);

    try {
      await prisma.destination.upsert({
        where: { osmId: p.osmId },
        create: {
          name: p.name,
          normalizedName: v.normalizeName(p.name),
          district,
          province,
          latitude: p.lat,
          longitude: p.lon,
          altitude: p.ele ?? null,
          category: p.category,
          description: p.tags.description || null,
          tags: [p.category.toLowerCase()],
          osmId: p.osmId,
          source: "OPENSTREETMAP",
          verified: true,
          routeAccessible: true,
          coordinateAccuracy: 10,
          dataQualityScore: qualityScore,
          sourceLastFetch: new Date(),
        },
        update: {
          name: p.name,
          normalizedName: v.normalizeName(p.name),
          latitude: p.lat,
          longitude: p.lon,
          altitude: p.ele ?? null,
          category: p.category,
          description: p.tags.description || null,
          tags: [p.category.toLowerCase()],
          verified: true,
          coordinateAccuracy: 10,
          dataQualityScore: qualityScore,
          sourceLastFetch: new Date(),
        },
      });
      created++;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Unique constraint")) {
        skipped++;
      } else {
        console.error(`  ✗ ${p.name}: ${err}`);
        skipped++;
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  ✓ ${i + 1}/${deduped.length} (created: ${created}, updated: ${updated}, skipped: ${skipped})`);
    }
  }

  const total = await prisma.destination.count();
  console.log("\n" + "═".repeat(50));
  console.log("📈 SUMMARY");
  console.log("═".repeat(50));
  console.log(`📊 OSM places matched to Wikipedia: ${deduped.length}`);
  console.log(`✅ Created: ${created}`);
  console.log(`⏭️  Skipped (quality): ${skippedQuality}`);
  console.log(`⏭️  Skipped (other): ${skipped}`);
  console.log(`🗄️  Total destinations in DB: ${total}`);

  const catCounts = await prisma.destination.groupBy({
    by: ["category"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  console.log("\n📊 Category breakdown:");
  for (const r of catCounts) {
    console.log(`  ${r.category}: ${r._count.id}`);
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
