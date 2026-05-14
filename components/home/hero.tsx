"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function Hero() {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onScroll = () => {
      el.style.setProperty("--scroll", `${window.scrollY * 0.4}px`);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section ref={heroRef} className="hero-bg relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-24 pb-32 overflow-hidden">
      {/* Ambient glows */}
      <div className="glow-dot w-96 h-96 bg-amber-500/20 top-1/4 -left-32" />
      <div className="glow-dot w-80 h-80 bg-sky-500/15 bottom-1/4 -right-24" />

      {/* Floating mountain silhouette */}
      <div className="absolute bottom-0 inset-x-0 h-40 mountain-wave bg-gradient-to-b from-slate-800/50 to-slate-900/80" />

      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="anim-1 mb-5 inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-body font-medium px-4 py-1.5 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
          </span>
          Live monitoring across Nepal
        </div>

        <h1 className="anim-2 font-display text-5xl md:text-7xl font-black leading-[1.05] mb-6">
          Travel{" "}
          <em className="shimmer-text not-italic">Smart.</em>
          <br />
          Travel <em className="shimmer-text not-italic">Safe.</em>
        </h1>

        <p className="anim-3 font-body text-slate-400 text-lg md:text-xl max-w-xl mx-auto leading-relaxed mb-10">
          AI-powered safety intelligence for every road, trail, and destination across Nepal — before and during your journey.
        </p>

        <div className="anim-4 flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/register">
            <Button className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-base px-8 py-6 rounded-full shadow-[0_0_40px_rgba(245,158,11,.3)] hover:shadow-[0_0_60px_rgba(245,158,11,.5)] transition-all duration-300 font-body group">
              Start for free
              <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button variant="outline" className="border-slate-600 hover:border-slate-400 text-slate-300 bg-transparent text-base px-8 py-6 rounded-full font-body transition-all duration-200">
              Sign in
            </Button>
          </Link>
        </div>

        <div className="anim-4 mt-8 flex items-center justify-center gap-1.5 font-body text-xs text-slate-500">
          <CheckCircle2 size={13} className="text-emerald-500" />
          No credit card required
          <span className="mx-2">·</span>
          <CheckCircle2 size={13} className="text-emerald-500" />
          Free for travellers
        </div>
      </div>
    </section>
  );
}
