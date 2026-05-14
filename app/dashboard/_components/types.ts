/**
 * FILE: types.ts
 * LOCATION: /app/dashboard/_components/types.ts
 * PURPOSE: Shared types and config constants used across all dashboard components
 */

import { Shield, AlertTriangle, Zap, XCircle, Waves, AlertOctagon, Flame, CloudRain, Info } from "lucide-react";

export interface Destination {
  id:          string;
  name:        string;
  district:    string;
  province:    string;
  altitude:    number | null;
  latitude?:   number | null;
  longitude?:  number | null;
  safetyScore: number;
  safetyLevel: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  confidence:  number | null;
  reasoning:   string[];
  weather:     {
    temperature: number;
    rainfall:    number;
    windSpeed:   number;
    description?: string;
    source?:      string;
    sourceLabel?: string;
    officialSource?: boolean;
    stationName?: string;
    stationDistanceKm?: number;
  } | null;
  hazard?: {
    floodIndex:     number;
    landslideIndex: number;
    earthquakeIndex: number;
    airQuality:     number;
    source?:        string;
  } | null;
  assessedAt:  string;
  isLive?:      boolean;
}

export interface UserProfile {
  id:       string;
  name:     string;
  email:    string;
  image:    string | null;
  username: string | null;
  homeLocation:     { name: string; district: string; province: string } | null;
  travelPurposes:   string[];
  emergencyContact: { name: string; phone: string; relation: string | null } | null;
  preference: {
    locationLat: number | null;
    locationLng: number | null;
    interests: string[];
    riskTolerance: string;
    travelStyle: string[];
    maxDistanceKm: number | null;
    typicalDurationDays: number | null;
  } | null;
  behavior: {
    metrics: Record<string, any>;
  } | null;
}

export interface HealthData {
  bloodType:         string | null;
  fitnessLevel:      "LOW" | "MODERATE" | "HIGH";
  mobilityLimited:   boolean;
  chronicConditions: string[];
  allergies:         string[];
}

export interface DashboardData {
  user:         UserProfile;
  destinations: Destination[];
  stats:        { total: number; safe: number; caution: number; highRisk: number; extreme: number };
}

export interface HazardNotif {
  id:       string;
  type:     "FLOOD" | "LANDSLIDE" | "EARTHQUAKE" | "FIRE" | "STORM" | "INFO";
  title:    string;
  body:     string;
  location: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  time:     string;
  read:     boolean;
}

export interface Friend {
  id:           string;
  name:         string;
  email:        string;
  image:        string | null;
  username:     string | null;
  status:       "ACCEPTED" | "PENDING_SENT" | "PENDING_RECEIVED";
  friendshipId: string;
}

export interface UserSearchResult {
  id:       string;
  name:     string;
  email:    string;
  image:    string | null;
  username: string | null;
  status:   "NONE" | "ACCEPTED" | "PENDING_SENT" | "PENDING_RECEIVED";
}

// ── Config constants ──────────────────────────────────────────────────────────

export const LEVEL_CONFIG = {
  SAFE:      { label: "Safe",      color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", icon: Shield },
  CAUTION:   { label: "Caution",   color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25",   icon: AlertTriangle },
  HIGH_RISK: { label: "High Risk", color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25",  icon: Zap },
  EXTREME:   { label: "Extreme",   color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25",     icon: XCircle },
};

export const HAZARD_CONFIG = {
  FLOOD:      { icon: Waves,        color: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-400/25" },
  LANDSLIDE:  { icon: AlertOctagon, color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/25" },
  EARTHQUAKE: { icon: Zap,          color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/25" },
  FIRE:       { icon: Flame,        color: "text-rose-400",   bg: "bg-rose-400/10",   border: "border-rose-400/25" },
  STORM:      { icon: CloudRain,    color: "text-sky-400",    bg: "bg-sky-400/10",    border: "border-sky-400/25" },
  INFO:       { icon: Info,         color: "text-slate-400",  bg: "bg-slate-400/10",  border: "border-slate-400/25" },
};

export const PURPOSE_LABELS: Record<string, string> = {
  SOLO: "Solo Travel", GROUP: "Group Travel",
  TREKKING: "Trekking", TOURISM: "Tourism",
};

export const BLOOD_TYPES_LIST     = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
export const FITNESS_LEVELS_LIST  = [
  { id: "LOW",      emoji: "🚶", label: "Low",      desc: "Light walking" },
  { id: "MODERATE", emoji: "🚴", label: "Moderate", desc: "Regular exercise" },
  { id: "HIGH",     emoji: "🏃", label: "High",     desc: "Intense training" },
];
export const CHRONIC_LIST = [
  { id: "diabetes",     label: "Diabetes",        icon: "💉" },
  { id: "hypertension", label: "Hypertension",    icon: "🩺" },
  { id: "asthma",       label: "Asthma",          icon: "🫁" },
  { id: "heart",        label: "Heart condition", icon: "❤️" },
];
export const COMMON_ALLERGIES_LIST = ["Peanuts", "Penicillin", "Pollen", "Dust", "Latex", "Shellfish"];
export const PURPOSES_LIST = [
  { id: "SOLO",     label: "Solo Travel" },
  { id: "GROUP",    label: "Group Travel" },
  { id: "TREKKING", label: "Trekking" },
  { id: "TOURISM",  label: "Tourism" },
];
export const PROVINCES: Record<string, string[]> = {
  "Koshi":         ["Taplejung","Sankhuwasabha","Solukhumbu","Okhaldhunga","Khotang","Bhojpur","Dhankuta","Terhathum","Panchthar","Ilam","Jhapa","Morang","Sunsari","Udayapur"],
  "Madhesh":       ["Saptari","Siraha","Dhanusha","Mahottari","Sarlahi","Rautahat","Bara","Parsa"],
  "Bagmati":       ["Sindhupalchok","Rasuwa","Nuwakot","Dhading","Kathmandu","Bhaktapur","Lalitpur","Kavrepalanchok","Sindhuli","Ramechhap","Dolakha","Makwanpur","Chitwan"],
  "Gandaki":       ["Gorkha","Manang","Mustang","Myagdi","Kaski","Lamjung","Tanahu","Nawalpur","Syangja","Parbat","Baglung"],
  "Lumbini":       ["Rukum East","Rolpa","Pyuthan","Gulmi","Arghakhanchi","Palpa","Nawalparasi West","Rupandehi","Kapilvastu","Dang","Banke","Bardiya"],
  "Karnali":       ["Dolpa","Mugu","Humla","Jumla","Kalikot","Dailekh","Jajarkot","Rukum West","Salyan","Surkhet"],
  "Sudurpashchim": ["Bajura","Bajhang","Darchula","Baitadi","Dadeldhura","Doti","Achham","Kailali","Kanchanpur"],
};
