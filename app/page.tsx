import React from "react";
import Link from "next/link";
import { Hero } from "@/components/home/hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Shield,
  Zap,
  Map,
  Mountain,
  ArrowRight,
  CheckCircle2,
  Radio,
} from "lucide-react";

const destinations = [
  {
    name: "Kathmandu",
    tag: "Cultural Hub",
    status: "Safe",
    statusColor: "text-emerald-400",
    desc: "Ancient temples and vibrant city life",
    gradient: "from-amber-900/60 to-slate-900/80",
  },
  {
    name: "Pokhara",
    tag: "Adventure Base",
    status: "Safe",
    statusColor: "text-emerald-400",
    desc: "Gateway to the Annapurna range",
    gradient: "from-blue-900/60 to-slate-900/80",
  },
  {
    name: "Chitwan",
    tag: "Wildlife",
    status: "Safe",
    statusColor: "text-emerald-400",
    desc: "Rhinos, tigers, and jungle safaris",
    gradient: "from-green-900/60 to-slate-900/80",
  },
  {
    name: "Lumbini",
    tag: "Sacred Site",
    status: "Safe",
    statusColor: "text-emerald-400",
    desc: "Birthplace of Buddha, world heritage",
    gradient: "from-yellow-900/60 to-slate-900/80",
  },
];

const features = [
  {
    icon: Shield,
    title: "AI Risk Assessment",
    desc: "Real-time safety scores powered by machine learning models trained on Nepal-specific hazard data.",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  {
    icon: Zap,
    title: "Instant Hazard Alerts",
    desc: "Floods, landslides, avalanche warnings — delivered before they become emergencies.",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
  },
  {
    icon: Map,
    title: "Smart Travel Plans",
    desc: "AI-curated itineraries that factor in weather, terrain difficulty, and live safety conditions.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
];

const stats = [
  { value: "50+", label: "Districts Covered" },
  { value: "24/7", label: "Live Monitoring" },
  { value: "98%", label: "Alert Accuracy" },
  { value: "12k+", label: "Travelers Protected" },
];

export default function Home() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background: "#0a0f1e",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}
    >
      {/* ── NAV ─────────────────────────────────────────────── */}
      <nav className="nav-blur fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 py-3 font-body">
        <div className="flex items-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 shadow-[0_0_28px_rgba(245,158,11,.14)]">
            <Mountain className="text-amber-300" size={20} />
          </span>
          <span className="font-display font-bold text-lg tracking-tight">
            YatraAI
          </span>
        </div>
        <div className="hidden items-center gap-6 rounded-full border border-white/8 bg-white/5 px-5 py-2 text-sm text-slate-400 backdrop-blur md:flex">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#destinations" className="hover:text-white transition-colors">Destinations</a>
          <a href="#safety" className="hover:text-white transition-colors">Safety</a>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sign-in">
            <Button variant="ghost" className="text-slate-300 hover:text-amber-500 cursor-pointer font-body text-sm">
              Sign In
            </Button>
          </Link>
          <Link href="/register">
            <Button className="bg-amber-500 hover:bg-amber-400 text-slate-900 cursor-pointer font-semibold text-sm px-5 rounded-full transition-all duration-200 hover:shadow-[0_0_20px_rgba(245,158,11,.4)]">
              Get Started
            </Button>
          </Link>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────── */}
      <Hero />

      {/* ── STATS ───────────────────────────────────────────── */}
      <section className="relative -mt-10 px-6 pb-16">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="stat-card p-6 text-center">
              <div className="font-display text-3xl font-black text-amber-400 mb-1">{s.value}</div>
              <div className="font-body text-xs text-slate-400 uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-sky-400/10 text-sky-400 border-sky-400/20 font-body text-xs uppercase tracking-widest px-4 py-1">
              How It Works
            </Badge>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white text-balance">
              Intelligence for every step
            </h2>
            <p className="mx-auto mt-4 max-w-2xl font-body text-slate-400">
              YatraAI turns weather, route, terrain, and personal context into simple travel decisions.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f) => (
              <Card key={f.title} className="card-hover group bg-slate-800/50 border-slate-700/50 backdrop-blur-sm rounded-3xl overflow-hidden">
                <CardContent className="p-8">
                  <div className={`${f.bg} w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-white/10 transition-transform group-hover:scale-105`}>
                    <f.icon className={f.color} size={22} />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-3">{f.title}</h3>
                  <p className="font-body text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── DESTINATIONS ────────────────────────────────────── */}
      <section id="destinations" className="py-24 px-6 relative">
        <div className="glow-dot w-96 h-96 bg-amber-500/10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-emerald-400/10 text-emerald-400 border-emerald-400/20 font-body text-xs uppercase tracking-widest px-4 py-1">
              Destinations
            </Badge>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white text-balance">
              Popular routes, monitored
            </h2>
            <p className="mx-auto mt-4 max-w-2xl font-body text-slate-400">
              A softer landing for big decisions: safety status, context, and next actions in one scan.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {destinations.map((d) => (
              <div key={d.name} className="showcase-card h-80 bg-slate-800 ring-1 ring-white/8">
                <img
                  src={`/images/${d.name.toLowerCase()}.png`}
                  alt={d.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className={`absolute inset-0 bg-gradient-to-br ${d.gradient} opacity-45 mix-blend-multiply`} />
                <div className="dest-overlay" />

                <div className="absolute inset-0 p-6 flex flex-col justify-between z-10">
                  <div className="flex justify-between items-start">
                    <Badge className="bg-slate-900/70 text-slate-300 border-slate-600/50 font-body text-xs backdrop-blur-sm">
                      {d.tag}
                    </Badge>
                    <span className={`font-body text-xs font-semibold ${d.statusColor} flex items-center gap-1`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      {d.status}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-bold text-white mb-1">{d.name}</h3>
                    <p className="font-body text-slate-300 text-xs mb-3">{d.desc}</p>
                    <div className="dest-arrow flex items-center gap-1 text-amber-400 text-xs font-body font-medium">
                      Explore <ArrowRight size={12} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ──────────────────────────────────────── */}
      <section id="safety" className="px-6 py-10">
        <div className="mx-auto grid max-w-6xl gap-6 rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 backdrop-blur md:grid-cols-3 md:p-8">
          {[
            ["Route aware", "Checks road segments, live hazards, and seasonal trouble spots."],
            ["Personalized", "Balances group health, altitude, budget, and travel timing."],
            ["Explainable", "Shows why a destination is safe, risky, or worth delaying."],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-4">
              <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-300/20">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-white">{title}</h3>
                <p className="mt-1 font-body text-sm leading-relaxed text-slate-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA BANNER ──────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 rounded-3xl bg-linear-to-br from-amber-500/10 to-sky-500/5 border border-amber-400/20" />
          <div className="relative z-10 py-16 px-8">
            <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-3xl border border-amber-300/20 bg-amber-300/10">
              <Radio className="text-amber-300" size={28} />
            </div>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
              Plan your next Nepal adventure
            </h2>
            <p className="font-body text-slate-400 text-lg mb-8 max-w-lg mx-auto">
              Join thousands of travellers who trust YatraAI for safe, confident exploration of Nepal.
            </p>
            <Link href="/register">
              <Button className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-base px-10 py-6 rounded-full font-body shadow-[0_0_40px_rgba(245,158,11,.25)] hover:shadow-[0_0_60px_rgba(245,158,11,.45)] transition-all duration-300 group">
                Create free account
                <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="border-t border-slate-800 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-display font-bold text-slate-400">
            <Mountain size={18} className="text-amber-400" />
            YatraAI
          </div>
          <Separator orientation="vertical" className="hidden md:block h-4 bg-slate-700" />
          <p className="font-body text-slate-500 text-sm">© 2026 YatraAI · AI Travel Safety for Nepal</p>
          <div className="flex gap-6 font-body text-sm text-slate-500">
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-300 transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-slate-300 transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
