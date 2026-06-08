"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, MapPin, Route, Shield, Sparkles } from "lucide-react";

export function Hero() {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onScroll = () => {
      el.style.setProperty("--scroll", `${window.scrollY * 0.3}px`);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      ref={heroRef}
      className="hero-bg relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-24 pb-32 overflow-hidden"
    >
      {/* Decorative mandala glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.04]"
          style={{
            background: "radial-gradient(circle, #CC2936 0%, #E68A2E 30%, transparent 60%)",
            borderRadius: "50%",
          }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, transparent 20%, #C9952B 40%, transparent 60%)",
            borderRadius: "50%",
            animation: "mandalaRotate 180s linear infinite",
          }}
        />
      </div>

      {/* Ambient glows */}
      <div className="glow-dot w-96 h-96 bg-nepali-red/15 top-1/4 -left-32" />
      <div className="glow-dot w-80 h-80 bg-saffron/10 bottom-1/4 -right-24" />
      <div className="glow-dot w-64 h-64 bg-gold/8 top-3/4 left-1/3" />

      {/* Mountain silhouette */}
      <div className="absolute bottom-0 inset-x-0 h-48 mountain-divider opacity-30" />
      <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-background to-transparent" />

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 text-left lg:grid-cols-[1fr_420px]">
        <div className="text-center lg:text-left">
        {/* Pill badge */}
        <div className="anim-1 mb-6 inline-flex items-center gap-2 bg-primary/10 border border-primary/25 text-primary text-xs font-body font-medium px-4 py-1.5 rounded-full shadow-[0_0_40px_rgba(245,158,11,.12)]">
          <Shield size={12} />
          <span>विश्वसनीय यात्रा सुरक्षा &mdash; Trusted travel safety for Nepal</span>
        </div>

        {/* Main heading */}
        <h1 className="anim-2 font-display text-5xl md:text-7xl font-black leading-[1.03] mb-6 text-balance">
          Explore Nepal,{" "}
          <br />
          <span className="shimmer-text">Travel Confident.</span>
        </h1>

        {/* Subtitle */}
        <p className="anim-3 font-body text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto lg:mx-0 leading-relaxed mb-10 text-pretty">
          Real-time AI-powered safety scores for every destination, road, and trail across Nepal. 
          Know before you go &mdash; from the mountains to the valleys.
        </p>

        {/* CTAs */}
        <div className="anim-4 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start items-center">
          <Link href="/register">
            <Button className="bg-primary hover:bg-gold text-primary-foreground font-semibold text-base px-8 py-6 rounded-full shadow-[0_0_40px_rgba(245,158,11,0.28)] hover:shadow-[0_0_60px_rgba(245,158,11,0.45)] transition-all duration-300 font-body group">
              Start your journey
              <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button variant="outline" className="border-border hover:border-accent text-muted-foreground hover:text-foreground bg-transparent text-base px-8 py-6 rounded-full font-body transition-all duration-200">
              Sign in
            </Button>
          </Link>
        </div>

        {/* Trust indicators */}
        <div className="anim-4 mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-body text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Free for travellers
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            No credit card required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            AI-powered insights
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gold" />
            नेपाली सेवा
          </span>
        </div>
        </div>

        <div className="anim-3 hidden lg:block">
          <div className="relative rounded-[2rem] border border-white/10 bg-slate-950/45 p-4 text-left shadow-[0_30px_90px_rgba(0,0,0,.42)] backdrop-blur-xl">
            <div className="absolute -inset-px rounded-[2rem] bg-linear-to-br from-amber-400/20 via-transparent to-sky-400/20 opacity-70" />
            <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#08111f]">
              <div className="h-44 bg-[radial-gradient(circle_at_32%_30%,rgba(245,158,11,.28),transparent_22%),radial-gradient(circle_at_70%_58%,rgba(56,189,248,.22),transparent_26%),linear-gradient(135deg,rgba(15,23,42,.4),rgba(15,23,42,.95))] p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-300">Live route check</span>
                  <Sparkles size={18} className="text-amber-300" />
                </div>
                <div className="mt-10 space-y-4">
                  <div className="flex items-center gap-3">
                    <MapPin size={16} className="text-amber-300" />
                    <div>
                      <p className="text-xs text-slate-500">From Kathmandu</p>
                      <p className="font-display text-xl font-bold text-white">Pokhara Lakeside</p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10">
                    <div className="h-full w-[82%] rounded-full bg-linear-to-r from-emerald-400 to-amber-300" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-px bg-white/10">
                {[
                  ["82", "Safety"],
                  ["3", "Routes"],
                  ["Low", "Weather"],
                ].map(([value, label]) => (
                  <div key={label} className="bg-slate-950/75 p-4">
                    <p className="font-display text-2xl font-bold text-white">{value}</p>
                    <p className="text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3 p-5">
                <div className="flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/10 p-3">
                  <Route size={16} className="mt-0.5 text-amber-300" />
                  <p className="text-sm leading-relaxed text-slate-300">Take Prithvi Highway early morning; rainfall risk rises after 3 PM.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
