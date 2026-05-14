"use client";

import Link from "next/link";
import { Mountain, CheckCircle2, ArrowRight, Shield, Zap, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function VerifyEmailSuccessPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "#0a0f1e" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display { font-family: 'Playfair Display', Georgia, serif; }
        .font-body    { font-family: 'DM Sans', system-ui, sans-serif; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes pop {
          0%   { transform: scale(0.4); opacity: 0; }
          60%  { transform: scale(1.15); }
          80%  { transform: scale(0.95); }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes checkDraw {
          from { stroke-dashoffset: 100; }
          to   { stroke-dashoffset: 0; }
        }

        .anim-1 { animation: fadeUp .6s ease both; }
        .anim-2 { animation: fadeUp .6s .1s ease both; }
        .anim-3 { animation: fadeUp .6s .2s ease both; }
        .anim-4 { animation: fadeUp .6s .3s ease both; }
        .pop    { animation: pop .6s cubic-bezier(.34,1.56,.64,1) .1s both; }

        .shimmer-text {
          background: linear-gradient(90deg, #f59e0b, #fde68a, #f59e0b, #fbbf24);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s linear infinite;
        }
        .glow-dot {
          position: absolute; border-radius: 9999px;
          filter: blur(80px); pointer-events: none;
        }
        .auth-card {
          background: rgba(15,23,42,0.85);
          border: 1px solid rgba(245,158,11,0.15);
          backdrop-filter: blur(24px);
          border-radius: 24px;
        }
        .mountain-wave {
          clip-path: polygon(0 40%,10% 25%,22% 38%,35% 10%,48% 30%,60% 5%,72% 22%,85% 12%,95% 28%,100% 18%,100% 100%,0 100%);
        }
        .amber-btn {
          background: #f59e0b; color: #0a0f1e;
          font-family: 'DM Sans', system-ui, sans-serif;
          font-weight: 600; border-radius: 10px;
          transition: background .2s, box-shadow .2s, transform .15s;
        }
        .amber-btn:hover {
          background: #fbbf24 !important;
          box-shadow: 0 0 32px rgba(245,158,11,.4);
          transform: translateY(-1px);
        }
        .feature-card {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          transition: border-color .25s, background .25s, transform .25s;
        }
        .feature-card:hover {
          border-color: rgba(245,158,11,.2);
          background: rgba(245,158,11,.04);
          transform: translateY(-2px);
        }
        .success-ring {
          position: absolute; inset: -3px;
          border-radius: 9999px;
          border: 2px solid rgba(52,211,153,.2);
          animation: ping-out 1.5s ease-out .3s both;
        }
        @keyframes ping-out {
          from { transform: scale(.8); opacity: .8; }
          to   { transform: scale(1.5); opacity: 0; }
        }
      `}</style>

      {/* Ambient glows */}
      <div className="glow-dot w-96 h-96 bg-emerald-500/10 -top-24 -right-24" />
      <div className="glow-dot w-96 h-96 bg-amber-500/10 bottom-0 -left-24" />
      <div className="absolute bottom-0 inset-x-0 h-28 mountain-wave bg-gradient-to-b from-slate-800/30 to-slate-900/50 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">

        {/* Logo */}
        <div className="anim-1 text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <Mountain className="text-amber-400 group-hover:scale-110 transition-transform" size={26} />
            <span className="font-display font-bold text-2xl text-white tracking-tight">YatraAI</span>
          </Link>
        </div>

        <div className="anim-2 auth-card p-8 md:p-10 text-center">

          {/* Success icon */}
          <div className="pop relative inline-flex items-center justify-center w-20 h-20 mb-6">
            <div className="success-ring" />
            <div className="w-full h-full rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="text-emerald-400" size={38} strokeWidth={1.5} />
            </div>
          </div>

          <Badge className="mb-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-body text-xs uppercase tracking-widest px-4 py-1">
            Account activated
          </Badge>

          <h1 className="font-display text-3xl font-bold text-white mb-3">
            You're all <em className="shimmer-text not-italic">set!</em>
          </h1>

          <p className="font-body text-slate-400 text-sm leading-relaxed mb-7">
            Your email is verified and your account is active. Welcome to YatraAI — Nepal's smartest travel companion.
          </p>

          <Separator className="bg-slate-800 mb-7" />

          {/* What you get */}
          <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-4 text-left">
            What's waiting for you
          </p>
          <div className="space-y-2 mb-8">
            {[
              { icon: Shield, color: "text-amber-400", bg: "bg-amber-400/10", text: "AI-powered safety scores for every destination" },
              { icon: Zap,    color: "text-sky-400",   bg: "bg-sky-400/10",   text: "Live flood, landslide & weather alerts" },
              { icon: Map,    color: "text-emerald-400", bg: "bg-emerald-400/10", text: "Personalized itineraries with risk insights" },
            ].map(({ icon: Icon, color, bg, text }) => (
              <div key={text} className="feature-card flex items-center gap-4 px-4 py-3 text-left">
                <div className={`${bg} w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <Icon className={color} size={15} />
                </div>
                <span className="font-body text-sm text-slate-300">{text}</span>
              </div>
            ))}
          </div>

          <Link href="/onboarding" className="block">
            <Button className="amber-btn w-full py-6 text-sm group">
              Set Up My Profile
              <ArrowRight size={15} className="ml-2 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </Link>

          <p className="font-body text-xs text-slate-500 mt-5">
            Not signed in automatically?{" "}
            <Link href="/login" className="text-amber-400 hover:text-amber-300 transition-colors">
              Sign in here
            </Link>
          </p>
        </div>

        <p className="anim-4 font-body text-center text-xs text-slate-600 mt-6">
          © 2026 YatraAI · Travel safe across Nepal
        </p>
      </div>
    </div>
  );
}
