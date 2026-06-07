"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield } from "lucide-react";

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

      <div className="relative z-10 max-w-4xl mx-auto">
        {/* Pill badge */}
        <div className="anim-1 mb-6 inline-flex items-center gap-2 bg-primary/10 border border-primary/25 text-primary text-xs font-body font-medium px-4 py-1.5 rounded-full">
          <Shield size={12} />
          <span>विश्वसनीय यात्रा सुरक्षा &mdash; Trusted travel safety for Nepal</span>
        </div>

        {/* Main heading */}
        <h1 className="anim-2 font-display text-5xl md:text-7xl font-black leading-[1.05] mb-6">
          Explore Nepal,{" "}
          <br />
          <span className="shimmer-text">Travel Confident.</span>
        </h1>

        {/* Subtitle */}
        <p className="anim-3 font-body text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
          Real-time AI-powered safety scores for every destination, road, and trail across Nepal. 
          Know before you go &mdash; from the mountains to the valleys.
        </p>

        {/* CTAs */}
        <div className="anim-4 flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/register">
            <Button className="bg-primary hover:bg-nepali-red text-primary-foreground font-semibold text-base px-8 py-6 rounded-full shadow-[0_0_40px_rgba(204,41,54,0.3)] hover:shadow-[0_0_60px_rgba(204,41,54,0.5)] transition-all duration-300 font-body group">
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
    </section>
  );
}
