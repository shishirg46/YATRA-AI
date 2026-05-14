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
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

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

  function toProvinceLabel(value: string) {
    const v = value.toLowerCase();
    if (v.includes("koshi") || v.includes("province1")) return "Koshi";
    if (v.includes("madhesh") || v.includes("province2")) return "Madhesh";
    if (v.includes("bagmati") || v.includes("province3")) return "Bagmati";
    if (v.includes("gandaki") || v.includes("province4")) return "Gandaki";
    if (v.includes("lumbini") || v.includes("province5")) return "Lumbini";
    if (v.includes("karnali") || v.includes("province6")) return "Karnali";
    if (v.includes("sudurpashchim") || v.includes("sudurpaschim") || v.includes("province7")) return "Sudurpashchim";
    return "";
  }

  async function autofillFromBrowserLocation() {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationNote("Location is not supported in this browser.");
      return;
    }
    setLocating(true);
    setLocationNote(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          setLocationLat(latitude);
          setLocationLng(longitude);

          const reverseRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=10&addressdetails=1`,
            { headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" } }
          );
          if (!reverseRes.ok) {
            setLocationNote("Location found, but auto-fill failed. Please select manually.");
            return;
          }

          const payload = await reverseRes.json();
          const address = payload?.address ?? {};
          const provinceCandidate = String(address.state ?? address.region ?? "").trim();
          const districtCandidate = String(address.state_district ?? address.county ?? address.city_district ?? "").trim();

          const detectedProvince = toProvinceLabel(provinceCandidate);
          if (!detectedProvince) {
            setLocationNote("Could not detect province from your location. Please select manually.");
            return;
          }

          const districtList = PROVINCES[detectedProvince] ?? [];
          const detectedDistrict = districtList.find((d) => normalizeName(d) === normalizeName(districtCandidate)) ?? "";

          setProvince(detectedProvince);
          if (detectedDistrict) {
            setDistrict(detectedDistrict);
            setLocationNote(`Auto-filled: ${detectedDistrict}, ${detectedProvince} Province.`);
          } else {
            setDistrict("");
            setLocationNote(`Detected ${detectedProvince} Province. Please choose your district.`);
          }
          setError(null);
        } catch {
          setLocationNote("Location found, but auto-fill failed. Please select manually.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocationNote("Location permission denied or unavailable. Please select manually.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
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
          locationLat,
          locationLng,
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
      className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden"
      style={{ background: "#0a0f1e" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeUp  {from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn {from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        @keyframes shimmer {0%{background-position:-200% center}100%{background-position:200% center}}
        .anim-1  {animation:fadeUp  .6s ease both}
        .anim-2  {animation:fadeUp  .6s .1s ease both}
        .slide-in{animation:slideIn .3s ease both}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .glow-dot{position:absolute;border-radius:9999px;filter:blur(80px);pointer-events:none}
        .auth-card{background:rgba(15,23,42,0.88);border:1px solid rgba(245,158,11,0.15);backdrop-filter:blur(24px);border-radius:24px}
        .mountain-wave{clip-path:polygon(0 40%,10% 25%,22% 38%,35% 10%,48% 30%,60% 5%,72% 22%,85% 12%,95% 28%,100% 18%,100% 100%,0 100%)}
        .auth-input,.auth-select{background:rgba(255,255,255,0.04)!important;border:1px solid rgba(255,255,255,0.1)!important;color:white!important;font-family:'DM Sans',system-ui,sans-serif!important;border-radius:10px!important;transition:border-color .2s,box-shadow .2s}
        .auth-input:focus,.auth-select:focus{border-color:rgba(245,158,11,.5)!important;box-shadow:0 0 0 3px rgba(245,158,11,.1)!important;outline:none!important}
        .auth-input::placeholder{color:rgba(255,255,255,0.25)!important}
        .auth-select option{background:#0f1729;color:white}
        .purpose-card{background:rgba(255,255,255,0.03);border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;cursor:pointer;transition:all .2s;padding:14px;position:relative;overflow:hidden;}
        .purpose-card:hover{border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.08);transform:translateY(-1px)}
        .purpose-card.active{border-color:#f59e0b;background:rgba(245,158,11,.15);box-shadow:0 0 0 1px #f59e0b inset,0 4px 20px rgba(245,158,11,.15);}
        .purpose-card.active::after{content:'✓';position:absolute;top:12px;right:14px;color:#f59e0b;font-weight:bold;font-size:16px;}
        .pill-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:9999px;cursor:pointer;transition:all .2s;font-family:'DM Sans',system-ui,sans-serif}
        .pill-btn:hover{border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.08)}
        .pill-btn.active{background:rgba(245,158,11,.2);border-color:#f59e0b;color:#fcd34d;box-shadow:0 0 0 1px #f59e0b inset;}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 32px rgba(245,158,11,.4);transform:translateY(-1px)}
        .amber-btn:disabled{opacity:.6;cursor:not-allowed}
        .step-dot{width:8px;height:8px;border-radius:50%;transition:all .3s}
      `}</style>

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

              {/* Auto-fill */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-body text-sm text-slate-200">Use current location</p>
                    <p className="font-body text-xs text-slate-500">Browser will ask permission and we&apos;ll auto-fill.</p>
                  </div>
                  <button
                    type="button"
                    onClick={autofillFromBrowserLocation}
                    disabled={locating}
                    className="px-3 py-2 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-slate-900 text-xs font-body font-semibold transition-colors disabled:opacity-50 shrink-0"
                  >
                    {locating ? "Detecting…" : "Enable"}
                  </button>
                </div>
                {locationNote && <p className="font-body text-xs text-slate-400 mt-2">{locationNote}</p>}
              </div>

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
