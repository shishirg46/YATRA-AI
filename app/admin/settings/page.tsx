/**
 * FILE: page.tsx
 * LOCATION: /app/admin/settings/page.tsx
 * PURPOSE: Admin settings — system configuration overview from code constants
 */

"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Route,
  Shield,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Mountain,
  Compass,
  Zap,
  Wind,
  Waves,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";

const ROUTING = {
  coefficients: [
    { name: "α (distance)", value: "1.0", desc: "Distance weight — base cost per km" },
    { name: "β (risk)", value: "0.3", desc: "Risk penalty weight — landslide + flood + monsoon" },
    { name: "γ (road quality)", value: "1.5", desc: "Road quality penalty weight" },
    { name: "δ (direction)", value: "0.8", desc: "Direction penalty weight — towards/away from destination" },
    { name: "ε (monsoon)", value: "0.5", desc: "Monsoon season weight — applied Jun–Sep" },
  ],
  monsoon: [
    { range: "0.0 – 0.3", penalty: "0", label: "Open road" },
    { range: "0.3 – 0.6", penalty: "50", label: "High monsoon risk" },
    { range: "0.6 – 0.8", penalty: "200", label: "Very high risk" },
    { range: "> 0.8", penalty: "∞ (excluded)", label: "Confirmed blocked" },
  ],
  roadConditions: [
    { condition: "GOOD", penalty: "0" },
    { condition: "FAIR", penalty: "1" },
    { condition: "POOR", penalty: "3" },
    { condition: "DIRT_TRACK", penalty: "6" },
    { condition: "IMPASSABLE", penalty: "50" },
    { condition: "unknown", penalty: "2 (default)" },
  ],
};

const SAFETY = {
  scoreLevels: [
    { range: "80–100", level: "SAFE", color: "text-emerald-400" },
    { range: "60–79", level: "CAUTION", color: "text-amber-400" },
    { range: "40–59", level: "HIGH_RISK", color: "text-orange-400" },
    { range: "0–39", level: "EXTREME", color: "text-red-400" },
  ],
  altitudePenalties: [
    { threshold: "≥ 5000m", penalty: "12", note: "Extreme — severe hypoxia risk" },
    { threshold: "≥ 4500m", penalty: "8", note: "Very high — AMS risk" },
    { threshold: "≥ 3500m", penalty: "5", note: "High — AMS risk" },
    { threshold: "≥ 2500m", penalty: "2", note: "Moderate" },
    { threshold: "≥ 1500m", penalty: "1", note: "Mild" },
    { threshold: "< 1500m", penalty: "0", note: "None" },
  ],
  staticPenalties: [
    { source: "Altitude", max: "12" },
    { source: "Remoteness", max: "10" },
    { source: "Seismic zone", max: "10" },
    { source: "Air quality (baseline)", max: "8" },
  ],
  weatherPenalties: [
    { source: "Rainfall", max: "20" },
    { source: "Wind", max: "10" },
    { source: "Temperature extreme", max: "10" },
  ],
  hazardPenalties: [
    { source: "Flood index", max: "25" },
    { source: "Landslide index", max: "25" },
    { source: "Earthquake index", max: "20" },
    { source: "Heat index", max: "5" },
    { source: "Air quality (live)", max: "5" },
  ],
  multipliers: [
    { purpose: "TREKKING", multiplier: "landslide ×1.8, wind ×1.3" },
    { purpose: "SOLO", multiplier: "all ×1.2" },
    { purpose: "TOURISM", multiplier: "air quality ×1.5" },
  ],
  riskTolerance: [
    { tolerance: "LOW", adjustment: "+10% to penalties" },
    { tolerance: "MEDIUM", adjustment: "no adjustment" },
    { tolerance: "HIGH", adjustment: "-10% to penalties" },
  ],
};

const RECOMMENDATIONS = {
  tiers: [
    { id: 0, label: "Tier 1 — Perfect Match", signals: "preference + health + safe + nearby", score: "8000+" },
    { id: 1, label: "Tier 2 — Health Match", signals: "preference + health + caution + nearby", score: "7000+" },
    { id: 2, label: "Tier 3 — Safe Pick", signals: "preference + safe + nearby", score: "6000+" },
    { id: 3, label: "Tier 4 — Safe Anywhere", signals: "preference + safe", score: "5000+" },
    { id: 4, label: "Tier 5 — Caution Pick", signals: "preference + caution", score: "4000+" },
    { id: 5, label: "Tier 6 — Popular Nearby", signals: "popular + safe + nearby", score: "3000+" },
    { id: 6, label: "Tier 7 — Popular Safe", signals: "popular + safe", score: "2000+" },
    { id: 7, label: "Tier 8 — Popular Caution", signals: "popular + caution", score: "1000+" },
  ],
  preferenceFields: ["name", "tags", "reasoning", "district", "routeRisk"],
  minFieldMatch: 2,
  excludedField: "category",
  boilerplate: [
    "Trekking — exposed terrain increases landslide and wind risk",
    "flood risk during monsoon trekking",
  ],
};

function SectionCard({ title, icon: Icon, iconColor, children }: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-800/60">
        <Icon size={18} className={iconColor} />
        <h2 className="font-display font-semibold text-white text-base">{title}</h2>
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}

function ParamTable({ headers, rows }: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            {headers.map((h, i) => (
              <th key={i} className="text-left font-body text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-800/40 last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="py-2.5 pr-4 font-body text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();

  return (
    <AppShell active="dashboard" title="Settings" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
            Back to Admin
          </Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white">Admin Settings</h1>
        <p className="font-body text-slate-400 mt-1">System configuration overview — values read from code constants</p>
      </div>

      <div className="space-y-6">
        {/* Routing Engine */}
        <SectionCard title="Routing Engine" icon={Route} iconColor="text-cyan-400">
          <div className="space-y-6">
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Multi-cost Coefficients</h3>
              <ParamTable
                headers={["Coefficient", "Value", "Description"]}
                rows={ROUTING.coefficients.map((c) => [c.name, c.value, c.desc])}
              />
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Monsoon Grading</h3>
              <ParamTable
                headers={["Vulnerability Score", "Cost Penalty", "Status"]}
                rows={ROUTING.monsoon.map((m) => [m.range, m.penalty, m.label])}
              />
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Road Condition Penalties</h3>
              <ParamTable
                headers={["Condition", "Accessibility Penalty"]}
                rows={ROUTING.roadConditions.map((r) => [r.condition, r.penalty])}
              />
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-cyan-400/5 border border-cyan-400/15">
              <RefreshCw size={14} className="text-cyan-400 shrink-0 mt-0.5" />
              <p className="font-body text-xs text-cyan-300/90">
                The graph answers &quot;Can I travel there?&quot; — safety is a separate post-processing layer. 
                These coefficients define the balanced internal routing cost only.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Safety Scoring */}
        <SectionCard title="Safety Scoring" icon={Shield} iconColor="text-emerald-400">
          <div className="space-y-6">
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Score Levels</h3>
              <ParamTable
                headers={["Score Range", "Level"]}
                rows={SAFETY.scoreLevels.map((s) => [
                  s.range,
                  <span key={s.level} className={`font-semibold ${s.color}`}>{s.level}</span>,
                ])}
              />
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Altitude Penalties</h3>
              <ParamTable
                headers={["Altitude", "Penalty", "Note"]}
                rows={SAFETY.altitudePenalties.map((a) => [a.threshold, a.penalty, a.note])}
              />
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Static Penalty Sources</h3>
              <ParamTable
                headers={["Source", "Max Penalty"]}
                rows={SAFETY.staticPenalties.map((s) => [s.source, s.max])}
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Weather Penalties</h3>
                <ParamTable
                  headers={["Source", "Max"]}
                  rows={SAFETY.weatherPenalties.map((w) => [w.source, w.max])}
                />
              </div>
              <div>
                <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Hazard Penalties</h3>
                <ParamTable
                  headers={["Source", "Max"]}
                  rows={SAFETY.hazardPenalties.map((h) => [h.source, h.max])}
                />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Purpose Multipliers</h3>
                <ParamTable
                  headers={["Purpose", "Multiplier"]}
                  rows={SAFETY.multipliers.map((m) => [m.purpose, m.multiplier])}
                />
              </div>
              <div>
                <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Risk Tolerance</h3>
                <ParamTable
                  headers={["Tolerance", "Adjustment"]}
                  rows={SAFETY.riskTolerance.map((r) => [r.tolerance, r.adjustment])}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Recommendation Engine */}
        <SectionCard title="Recommendation Engine" icon={Sparkles} iconColor="text-amber-400">
          <div className="space-y-6">
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Priority Tiers</h3>
              <ParamTable
                headers={["Tier", "Signals", "Base Score"]}
                rows={RECOMMENDATIONS.tiers.map((t) => [
                  <span key={t.id} className="font-semibold text-white">{t.label}</span>,
                  t.signals,
                  t.score,
                ])}
              />
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Preference Matching</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-slate-400">Search fields</span>
                  <p className="font-body text-sm text-slate-200 mt-1">{RECOMMENDATIONS.preferenceFields.join(", ")}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-slate-400">Min field matches</span>
                  <p className="font-body text-sm text-slate-200 mt-1">{RECOMMENDATIONS.minFieldMatch}+</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-slate-400">Excluded field</span>
                  <p className="font-body text-sm text-slate-200 mt-1">{RECOMMENDATIONS.excludedField}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-slate-400">Boilerplate filtered</span>
                  <p className="font-body text-sm text-slate-200 mt-1">{RECOMMENDATIONS.boilerplate.length} patterns</p>
                  <ul className="mt-1 space-y-0.5">
                    {RECOMMENDATIONS.boilerplate.map((b, i) => (
                      <li key={i} className="font-body text-[11px] text-slate-500 italic truncate">"{b}"</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-400/5 border border-amber-400/15">
              <TrendingUp size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="font-body text-xs text-amber-300/90">
                Non-tiered destinations get penalized with -50,000 when user has preferences, 
                ensuring preference-matched destinations always sort first.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Hazard & Scoring */}
        <SectionCard title="Hazard & Scoring" icon={AlertTriangle} iconColor="text-red-400">
          <div className="space-y-6">
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Independent Hazard Scores — Weights</h3>
              <div className="grid md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/40 text-center">
                  <LandslideIcon size={16} className="text-orange-400 mx-auto mb-1" />
                  <span className="block font-body text-xs text-slate-400">Landslide</span>
                  <span className="block font-display text-lg font-bold text-white">40%</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40 text-center">
                  <Waves size={16} className="text-blue-400 mx-auto mb-1" />
                  <span className="block font-body text-xs text-slate-400">Flood</span>
                  <span className="block font-display text-lg font-bold text-white">30%</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40 text-center">
                  <Wind size={16} className="text-sky-400 mx-auto mb-1" />
                  <span className="block font-body text-xs text-slate-400">Weather</span>
                  <span className="block font-display text-lg font-bold text-white">15%</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40 text-center">
                  <Zap size={16} className="text-red-400 mx-auto mb-1" />
                  <span className="block font-body text-xs text-slate-400">Seismic</span>
                  <span className="block font-display text-lg font-bold text-white">15%</span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="font-body text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Seismic Risk Districts</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-rose-400 font-semibold">High (penalty: 10)</span>
                  <p className="font-body text-xs text-slate-400 mt-1 leading-relaxed">
                    Sindhupalchok, Gorkha, Nuwakot, Dolakha, Kavrepalanchok, Rasuwa, Dhading, Makwanpur, Lamjung, Kaski, Solukhumbu, Ramechhap, Sindhuli, Okhaldhunga
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/40">
                  <span className="font-body text-xs text-amber-400 font-semibold">Moderate (penalty: 5)</span>
                  <p className="font-body text-xs text-slate-400 mt-1 leading-relaxed">
                    Kathmandu, Bhaktapur, Lalitpur, Tanahu, Syangja, Parbat, Baglung, Myagdi, Mustang, Manang, Rukum, Rolpa, Jajarkot, Surkhet, Dailekh
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* System Info */}
        <SectionCard title="System Info" icon={Compass} iconColor="text-purple-400">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40">
              <span className="font-body text-sm text-slate-300">Graph nodes</span>
              <span className="font-display font-bold text-white">2,018</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40">
              <span className="font-body text-sm text-slate-300">Graph edges</span>
              <span className="font-display font-bold text-white">5,548</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40">
              <span className="font-body text-sm text-slate-300">Edges with attributes</span>
              <span className="font-display font-bold text-white">304</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40">
              <span className="font-body text-sm text-slate-300">Corridor definitions</span>
              <span className="font-display font-bold text-white">6</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40">
              <span className="font-body text-sm text-slate-300">Corridor nodes seeded</span>
              <span className="font-display font-bold text-white">158</span>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-400/5 border border-purple-400/15 mt-3">
              <Mountain size={14} className="text-purple-400 shrink-0 mt-0.5" />
              <p className="font-body text-xs text-purple-300/90">
                Configuration values read from code constants. To make these editable at runtime, 
                a settings model needs to be added to the Prisma schema and backed by an API.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}

function LandslideIcon(props: { size: number; className?: string }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M3 15l5-5 3 3 5-5" />
      <path d="M21 21H3" />
      <path d="M21 15l-3-3-2 2" />
    </svg>
  );
}
