"use client";

import Link from "next/link";
import {
  Mountain, PhoneCall, Shield, FileText, Mail, UserCog, Route,
  Settings, AlertTriangle, ArrowRight,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";

const links = [
  { href: "/accessibility", icon: Route, label: "Routes", desc: "Route accessibility & safety map" },
  { href: "/settings", icon: Settings, label: "Settings", desc: "Profile, preferences, security & more" },
  { href: "/settings/emergency", icon: UserCog, label: "Emergency Contacts", desc: "Manage your emergency contacts" },
  { href: "/emergency-numbers", icon: PhoneCall, label: "Emergency Numbers", desc: "National hotlines & hospital contacts" },
  { href: "/privacy", icon: Shield, label: "Privacy Policy", desc: "How we handle your data" },
  { href: "/terms", icon: FileText, label: "Terms of Service", desc: "Terms & conditions" },
  { href: "/contact", icon: Mail, label: "Contact Us", desc: "Get in touch with the team" },
];

export default function MorePage() {
  return (
    <AppShell active="more" title="More">
      <div className="space-y-4">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-white">More</h1>
          <p className="font-body text-sm text-slate-400 mt-1">Resources and settings</p>
        </div>
        <div className="grid gap-3">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="glass-card p-4 flex items-center gap-4 hover:border-amber-400/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-400/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold text-white text-sm">{link.label}</p>
                  <p className="font-body text-xs text-slate-500 truncate">{link.desc}</p>
                </div>
                <ArrowRight size={16} className="text-slate-600 group-hover:text-amber-400 transition-colors shrink-0" />
              </Link>
            );
          })}
        </div>
        <div className="glass-card p-5 mt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm text-white font-semibold mb-1">In an emergency?</p>
              <p className="font-body text-xs text-slate-400 leading-relaxed">
                Call <strong className="text-white">100</strong> (Police),{" "}
                <strong className="text-white">102</strong> (Ambulance), or{" "}
                <strong className="text-white">1144</strong> (Tourist Police).
                Your SOS contacts will be notified via email.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
