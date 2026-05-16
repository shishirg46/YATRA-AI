/**
 * FILE: page.tsx
 * LOCATION: /app/onboarding/page.tsx
 * PURPOSE: 5-step onboarding focused on collecting decision-making signals
 */
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Mountain, ArrowRight, ArrowLeft, MapPin, AtSign,
  Compass, ShieldAlert, Navigation, Clock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Static data ───────────────────────────────────────────────────────────────

const PROVINCES: Record<string, string[]> = {
  "Koshi":         ["Taplejung","Sankhuwasabha","Solukhumbu","Okhaldhunga","Khotang","Bhojpur","Dhankuta","Terhathum","Panchthar","Ilam","Jhapa","Morang","Sunsari","Udayapur"],
  "Madhesh":       ["Saptari","Siraha","Dhanusha","Mahottari","Sarlahi","Rautahat","Bara","Parsa"],
  "Bagmati":       ["Sindhupalchok","Rasuwa","Nuwakot","Dhading","Kathmandu","Bhaktapur","Lalitpur","Kavrepalanchok","Sindhuli","Ramechhap","Dolakha","Makwanpur","Chitwan"],
  "Gandaki":       ["Gorkha","Manang","Mustang","Myagdi","Kaski","Lamjung","Tanahu","Nawalpur","Syangja","Parbat","Baglung"],
  "Lumbini":       ["Rukum East","Rolpa","Pyuthan","Gulmi","Arghakhanchi","Palpa","Nawalparasi West","Rupandehi","Kapilvastu","Dang","Banke","Bardiya"],
  "Karnali":       ["Dolpa","Mugu","Humla","Jumla","Kalikot","Dailekh","Jajarkot","Rukum West","Salyan","Surkhet"],
  "Sudurpashchim": ["Bajura","Bajhang","Darchula","Baitadi","Dadeldhura","Doti","Achham","Kailali","Kanchanpur"],
};

const INTERESTS = [
  { id: "trekking",  emoji: "⛰️", label: "Trekking", desc: "Long hikes & trails" },
  { id: "nature",    emoji: "🌲", label: "Nature",   desc: "Wildlife & forests" },
  { id: "lakes",     emoji: "🌊", label: "Lakes",    desc: "Rivers & lakes" },
  { id: "culture",   emoji: "🏛️", label: "Culture",  desc: "Heritage sites" },
  { id: "adventure", emoji: "🧗", label: "Adventure",desc: "Extreme sports" },
];

const TRAVEL_STYLES = [
  { id: "relaxation", emoji: "😌", label: "Relaxation", desc: "Chill and unwind" },
  { id: "adventure",  emoji: "🔥", label: "Adventure",  desc: "Thrill-seeking" },
  { id: "cultural",   emoji: "🎭", label: "Cultural",   desc: "Local experiences" },
  { id: "budget",     emoji: "🎒", label: "Budget",     desc: "Backpacking" },
  { id: "luxury",     emoji: "💎", label: "Luxury",     desc: "Premium comfort" },
];

const RISK_TOLERANCES = [
  { id: "LOW",    emoji: "🛡️", label: "Low",    desc: "Only safe places" },
  { id: "MEDIUM", emoji: "⚖️", label: "Medium", desc: "Balanced approach" },
  { id: "HIGH",   emoji: "⚡", label: "High",   desc: "Okay with risky areas" },
];

const DURATIONS = [
  { label: "1-2 days", value: 2 },
  { label: "3-5 days", value: 4 },
  { label: "1 week+",  value: 7 },
];
const DISTANCES = [50, 100, 300, 1000];
const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const FITNESS_LEVELS = [
  { id: "LOW", label: "Low" },
  { id: "MODERATE", label: "Moderate" },
  { id: "HIGH", label: "High" },
];
const CHRONIC_CONDITIONS = [
  { id: "diabetes", label: "Diabetes" },
  { id: "hypertension", label: "Hypertension" },
  { id: "asthma", label: "Asthma" },
  { id: "heart", label: "Heart condition" },
];
const COMMON_ALLERGIES = ["Peanuts", "Penicillin", "Pollen", "Dust", "Latex", "Shellfish"];

type Step = "location" | "interests" | "risk" | "style" | "constraints";
const STEPS: Step[]       = ["location", "interests", "risk", "style", "constraints"];
const STEP_LABELS: string[] = ["Location", "Interests", "Risk", "Style", "Trip"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  const [step,   setStep]   = useState<Step>("location");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);

  // ── Step 1: Location ───────────────────────────────────────────────────────
  const [username, setUsername] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");

  // ── Step 2: Interests ──────────────────────────────────────────────────────
  const [interests, setInterests] = useState<string[]>([]);

  // ── Step 3: Risk Tolerance ─────────────────────────────────────────────────
  const [riskTolerance, setRiskTolerance] = useState<string>("MEDIUM");

  // ── Step 4: Travel Style ───────────────────────────────────────────────────
  const [travelStyle, setTravelStyle] = useState<string[]>([]);

  // ── Step 5: Trip Constraints ───────────────────────────────────────────────
  const [duration, setDuration] = useState<number | null>(null);
  const [distance, setDistance] = useState<number>(300);
  const [bloodType, setBloodType] = useState<string>("");
  const [fitnessLevel, setFitnessLevel] = useState<"LOW" | "MODERATE" | "HIGH">("MODERATE");
  const [mobilityLimited, setMobilityLimited] = useState(false);
  const [chronicConditions, setChronicConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);

  function normalizeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }



  useEffect(() => {
    fetch("/api/user/profile-status", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.hasProfile) {
          router.replace("/dashboard");
          return;
        }
        if (d.needsUsername) setNeedsUsername(true);
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    fetch("/api/user/health", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setBloodType(d.bloodType ?? "");
        setFitnessLevel((d.fitnessLevel ?? "MODERATE") as "LOW" | "MODERATE" | "HIGH");
        setMobilityLimited(Boolean(d.mobilityLimited));
        setChronicConditions(Array.isArray(d.chronicConditions) ? d.chronicConditions : []);
        setAllergies(Array.isArray(d.allergies) ? d.allergies : []);
      })
      .catch(() => {});
  }, []);

  const stepIndex = STEPS.indexOf(step);

  // ── Validators ─────────────────────────────────────────────────────────────

  function nextStep(current: Step) {
    if (current === "location") {
      if (needsUsername) {
        if (!username.trim())                     { setError("Please choose a username."); return; }
        if (!/^[a-z0-9_]{3,20}$/.test(username)) { setError("Username: 3–20 chars, lowercase + numbers + _ only."); return; }
      }
      if (!province) { setError("Please select your province."); return; }
      if (!district) { setError("Please select your district."); return; }
      setError(null);
      setStep("interests");
    } else if (current === "interests") {
      if (interests.length === 0) { setError("Please select at least one interest."); return; }
      setError(null);
      setStep("risk");
    } else if (current === "risk") {
      if (!riskTolerance) { setError("Please select your risk tolerance."); return; }
      setError(null);
      setStep("style");
    } else if (current === "style") {
      if (travelStyle.length === 0) { setError("Please select at least one travel style."); return; }
      setError(null);
      setStep("constraints");
    }
  }

  // ── Final submit ───────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!duration) { setError("Please select a typical trip duration."); return; }
    
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/user/onboarding", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: needsUsername ? username : undefined,
          province, 
          district,
          interests,
          riskTolerance,
          travelStyle,
          maxDistanceKm: distance,
          typicalDurationDays: duration
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.message ?? "Failed to save profile.");
        return;
      }

      const healthRes = await fetch("/api/user/health", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bloodType: bloodType || null,
          fitnessLevel,
          mobilityLimited,
          chronicConditions,
          allergies,
        }),
      });
      if (!healthRes.ok) {
        const d = await healthRes.json();
        setError(d.message ?? "Failed to save health profile.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function toggleItem<T>(list: T[], setList: (v: T[]) => void, item: T) {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="yatra-page min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden"
    >
      <div className="glow-dot w-80 h-80 bg-amber-500/15 -top-20 -right-20" />
      <div className="glow-dot w-72 h-72 bg-sky-500/10 bottom-0 -left-20" />
      <div className="absolute bottom-0 inset-x-0 h-24 mountain-wave bg-gradient-to-b from-slate-800/30 to-slate-900/50 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">

        {/* Logo */}
        <div className="anim-1 text-center mb-6">
          <div className="inline-flex items-center gap-2">
            <Mountain className="text-amber-400" size={24} />
            <span className="font-display font-bold text-2xl text-white tracking-tight">YatraAI</span>
          </div>
        </div>

        {/* Step progress indicator */}
        <div className="anim-1 flex items-center justify-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex flex-col items-center gap-1">
                <div className={`step-dot ${i <= stepIndex ? "bg-amber-400 scale-110" : "bg-slate-700"}`} />
                <span className={`font-body text-[9px] sm:text-[10px] uppercase tracking-widest ${i <= stepIndex ? "text-amber-400" : "text-slate-600"}`}>
                  {STEP_LABELS[i]}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-4 sm:w-8 h-px mb-4 transition-colors duration-300 ${i < stepIndex ? "bg-amber-400/50" : "bg-slate-700"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="anim-2 auth-card p-6 sm:p-8">

          {/* ────────────── STEP 1: Location ────────────────────────────────── */}
          {step === "location" && (
            <div className="slide-in flex flex-col gap-5">
              <div>
                <Badge className="mb-3 bg-amber-400/10 text-amber-400 border-amber-400/20 font-body text-xs uppercase tracking-widest px-3 py-1">
                  Step 1 of 5
                </Badge>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Where are you <em className="shimmer-text not-italic">from?</em>
                </h2>
                <p className="font-body text-slate-400 text-sm">We use your location to calculate distance to destinations.</p>
              </div>

              {/* Username — Google users only */}
              {needsUsername && (
                <div className="grid gap-2">
                  <Label className="font-body text-xs text-slate-400 uppercase tracking-widest">
                    Username <span className="text-red-400">*</span>
                  </Label>
                  <div className="flex h-11 rounded-xl border border-white/10 overflow-hidden focus-within:border-amber-500/50 focus-within:ring-2 focus-within:ring-amber-500/10 transition-all" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="flex items-center px-3 border-r border-white/10">
                      <AtSign size={14} className="text-slate-500" />
                    </div>
                    <input
                      type="text"
                      placeholder="your_username"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); setError(null); }}
                      className="flex-1 bg-transparent text-white text-sm px-3 outline-none font-body placeholder:text-white/25"
                    />
                  </div>
                  <p className="font-body text-xs text-slate-600">3–20 chars · lowercase · numbers · underscore only</p>
                </div>
              )}



              {/* Province */}
              <div className="grid gap-2">
                <Label className="font-body text-xs text-slate-400 uppercase tracking-widest">
                  Province <span className="text-red-400">*</span>
                </Label>
                <select
                  value={province}
                  onChange={(e) => { setProvince(e.target.value); setDistrict(""); setError(null); }}
                  className="auth-select h-11 px-3 w-full"
                >
                  <option value="">Select province…</option>
                  {Object.keys(PROVINCES).map((p) => (
                    <option key={p} value={p}>{p} Province</option>
                  ))}
                </select>
              </div>

              {/* District */}
              <div className="grid gap-2">
                <Label className="font-body text-xs text-slate-400 uppercase tracking-widest">
                  District <span className="text-red-400">*</span>
                </Label>
                <select
                  value={district}
                  onChange={(e) => { setDistrict(e.target.value); setError(null); }}
                  disabled={!province}
                  className="auth-select h-11 px-3 w-full disabled:opacity-40"
                >
                  <option value="">Select district…</option>
                  {(PROVINCES[province] ?? []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {error && <p className="text-red-400 font-body text-sm">{error}</p>}

              <button onClick={() => nextStep("location")} className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm mt-2 group">
                Continue <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          )}

          {/* ────────────── STEP 2: Interests ───────────────────────────────── */}
          {step === "interests" && (
            <div className="slide-in flex flex-col gap-6">
              <div>
                <Badge className="mb-3 bg-sky-400/10 text-sky-400 border-sky-400/20 font-body text-xs uppercase tracking-widest px-3 py-1">
                  Step 2 of 5
                </Badge>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Your <em className="shimmer-text not-italic">interests</em>
                </h2>
                <p className="font-body text-slate-400 text-sm">Select multiple interests to personalize your dashboard.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {INTERESTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { toggleItem(interests, setInterests, p.id); setError(null); }}
                    className={`purpose-card text-left ${interests.includes(p.id) ? "active" : ""}`}
                  >
                    <div className="text-xl mb-1.5">{p.emoji}</div>
                    <div className="font-body font-semibold text-sm text-white">{p.label}</div>
                    <div className="font-body text-xs text-slate-500 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>

              {error && <p className="text-red-400 font-body text-sm">{error}</p>}

              <div className="flex gap-3 mt-2">
                <button onClick={() => setStep("location")} className="flex items-center gap-1.5 px-5 py-3 font-body text-sm text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-xl transition-all">
                  <ArrowLeft size={14} /> Back
                </button>
                <button onClick={() => nextStep("interests")} className="amber-btn flex-1 py-3 flex items-center justify-center gap-2 text-sm group">
                  Continue <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          )}

          {/* ────────────── STEP 3: Risk Tolerance ──────────────────────────── */}
          {step === "risk" && (
            <div className="slide-in flex flex-col gap-6">
              <div>
                <Badge className="mb-3 bg-rose-400/10 text-rose-400 border-rose-400/20 font-body text-xs uppercase tracking-widest px-3 py-1">
                  Step 3 of 5
                </Badge>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Risk <em className="shimmer-text not-italic">tolerance</em>
                </h2>
                <p className="font-body text-slate-400 text-sm">How do you feel about traveling to areas with active hazards or extreme weather?</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {RISK_TOLERANCES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setRiskTolerance(r.id); setError(null); }}
                    className={`purpose-card text-left flex items-center gap-4 ${riskTolerance === r.id ? "active" : ""}`}
                  >
                    <div className="text-3xl">{r.emoji}</div>
                    <div>
                      <div className="font-body font-semibold text-sm text-white">{r.label}</div>
                      <div className="font-body text-xs text-slate-500 mt-0.5">{r.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {error && <p className="text-red-400 font-body text-sm">{error}</p>}

              <div className="flex gap-3 mt-2">
                <button onClick={() => setStep("interests")} className="flex items-center gap-1.5 px-5 py-3 font-body text-sm text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-xl transition-all">
                  <ArrowLeft size={14} /> Back
                </button>
                <button onClick={() => nextStep("risk")} className="amber-btn flex-1 py-3 flex items-center justify-center gap-2 text-sm group">
                  Continue <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          )}

          {/* ────────────── STEP 4: Travel Style ────────────────────────────── */}
          {step === "style" && (
            <div className="slide-in flex flex-col gap-6">
              <div>
                <Badge className="mb-3 bg-purple-400/10 text-purple-400 border-purple-400/20 font-body text-xs uppercase tracking-widest px-3 py-1">
                  Step 4 of 5
                </Badge>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Travel <em className="shimmer-text not-italic">style</em>
                </h2>
                <p className="font-body text-slate-400 text-sm">What kind of experiences do you look for?</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {TRAVEL_STYLES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { toggleItem(travelStyle, setTravelStyle, t.id); setError(null); }}
                    className={`purpose-card text-left ${travelStyle.includes(t.id) ? "active" : ""}`}
                  >
                    <div className="text-xl mb-1.5">{t.emoji}</div>
                    <div className="font-body font-semibold text-sm text-white">{t.label}</div>
                    <div className="font-body text-xs text-slate-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>

              {error && <p className="text-red-400 font-body text-sm">{error}</p>}

              <div className="flex gap-3 mt-2">
                <button onClick={() => setStep("risk")} className="flex items-center gap-1.5 px-5 py-3 font-body text-sm text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-xl transition-all">
                  <ArrowLeft size={14} /> Back
                </button>
                <button onClick={() => nextStep("style")} className="amber-btn flex-1 py-3 flex items-center justify-center gap-2 text-sm group">
                  Continue <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          )}

          {/* ────────────── STEP 5: Trip Constraints ────────────────────────── */}
          {step === "constraints" && (
            <div className="slide-in flex flex-col gap-6">
              <div>
                <Badge className="mb-3 bg-emerald-400/10 text-emerald-400 border-emerald-400/20 font-body text-xs uppercase tracking-widest px-3 py-1">
                  Step 5 of 5
                </Badge>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Trip <em className="shimmer-text not-italic">constraints</em>
                </h2>
                <p className="font-body text-slate-400 text-sm">Help us recommend places that fit your schedule and reach.</p>
              </div>

              {/* Duration */}
              <div className="grid gap-2">
                <Label className="font-body text-xs text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Clock size={12} className="text-emerald-400" /> Typical trip duration <span className="text-red-400">*</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => { setDuration(d.value); setError(null); }}
                      className={`pill-btn px-4 py-2 text-sm font-medium text-slate-300 ${duration === d.value ? "active" : ""}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Distance */}
              <div className="grid gap-2 mt-4">
                <Label className="font-body text-xs text-slate-400 uppercase tracking-widest flex items-center gap-1.5 justify-between">
                  <span className="flex items-center gap-1.5"><Navigation size={12} className="text-amber-400" /> Willing to travel (max distance)</span>
                  <span className="text-amber-400 font-bold font-mono">{distance === 1000 ? "Any distance" : `${distance} km`}</span>
                </Label>
                <input
                  type="range"
                  min="10"
                  max="1000"
                  step="10"
                  value={distance}
                  onChange={(e) => setDistance(Number(e.target.value))}
                  className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between font-body text-[10px] text-slate-500 px-1">
                  <span>Local</span>
                  <span>National</span>
                  <span>Anywhere</span>
                </div>
              </div>

              {/* Health */}
              <div className="grid gap-3 mt-4 pt-4 border-t border-white/10">
                <Label className="font-body text-xs text-slate-400 uppercase tracking-widest">
                  Health profile
                </Label>
                <div className="grid gap-2">
                  <p className="font-body text-xs text-slate-500">Fitness level</p>
                  <div className="flex gap-2 flex-wrap">
                    {FITNESS_LEVELS.map((f) => (
                      <button key={f.id} type="button" onClick={() => setFitnessLevel(f.id as "LOW" | "MODERATE" | "HIGH")}
                        className={`pill-btn px-3 py-1.5 text-xs ${fitnessLevel === f.id ? "active" : ""}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <p className="font-body text-xs text-slate-500">Blood type (optional)</p>
                  <select value={bloodType} onChange={(e) => setBloodType(e.target.value)} className="auth-select h-10 px-3 w-full">
                    <option value="">Prefer not to say</option>
                    {BLOOD_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 font-body text-sm text-slate-300">
                  <input type="checkbox" checked={mobilityLimited} onChange={(e) => setMobilityLimited(e.target.checked)} />
                  Mobility limited
                </label>
                <div className="grid gap-2">
                  <p className="font-body text-xs text-slate-500">Chronic conditions</p>
                  <div className="flex flex-wrap gap-2">
                    {CHRONIC_CONDITIONS.map((c) => (
                      <button key={c.id} type="button"
                        onClick={() => toggleItem(chronicConditions, setChronicConditions, c.id)}
                        className={`pill-btn px-3 py-1.5 text-xs ${chronicConditions.includes(c.id) ? "active" : ""}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <p className="font-body text-xs text-slate-500">Allergies</p>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_ALLERGIES.map((a) => (
                      <button key={a} type="button"
                        onClick={() => toggleItem(allergies, setAllergies, a)}
                        className={`pill-btn px-3 py-1.5 text-xs ${allergies.includes(a) ? "active" : ""}`}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && <p className="text-red-400 font-body text-sm">{error}</p>}

              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep("style")} className="flex items-center gap-1.5 px-5 py-3 font-body text-sm text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-xl transition-all">
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="amber-btn flex-1 py-3 flex items-center justify-center gap-2 text-sm group"
                >
                  {saving ? "Saving…" : (
                    <>Go to Dashboard <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
