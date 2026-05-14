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
  Wind,
  Mountain,
  ArrowRight,
  Star,
  CheckCircle2,
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
      <nav className="nav-blur fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 font-body">
        <div className="flex items-center gap-2">
          <Mountain className="text-amber-400" size={22} />
          <span className="font-display font-bold text-lg tracking-tight">
            YatraAI
          </span>
        </div>
        <div className="flex items-center gap-3">
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
      <section className="relative py-16 px-6">
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
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-sky-400/10 text-sky-400 border-sky-400/20 font-body text-xs uppercase tracking-widest px-4 py-1">
              How It Works
            </Badge>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white">
              Intelligence for every step
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f) => (
              <Card key={f.title} className="card-hover bg-slate-800/50 border-slate-700/50 backdrop-blur-sm rounded-2xl overflow-hidden">
                <CardContent className="p-8">
                  <div className={`${f.bg} w-12 h-12 rounded-xl flex items-center justify-center mb-6`}>
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
      <section className="py-24 px-6 relative">
        <div className="glow-dot w-96 h-96 bg-amber-500/10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-emerald-400/10 text-emerald-400 border-emerald-400/20 font-body text-xs uppercase tracking-widest px-4 py-1">
              Destinations
            </Badge>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white">
              Popular routes, monitored
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {destinations.map((d) => (
              <div key={d.name} className="dest-card h-72 bg-slate-800">
                <img
                  src={`/images/${d.name.toLowerCase()}.png`}
                  alt={d.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Placeholder gradient when no image */}
                <div className={`absolute inset-0 bg-gradient-to-br ${d.gradient}`} />
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
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 rounded-3xl bg-linear-to-br from-amber-500/10 to-sky-500/5 border border-amber-400/20" />
          <div className="relative z-10 py-16 px-8">
            <Star className="text-amber-400 mx-auto mb-6" size={32} />
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