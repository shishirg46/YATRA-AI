"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ChevronRight, X, Check, Loader2, MapPin,
  Edit, LogOut, Eye, EyeOff, Shield, PhoneCall,
  User, Mail, Lock, AlertTriangle, Mountain,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";
import { PhotoUpload } from "@/app/dashboard/_components/ui";
import { PROVINCES } from "@/app/dashboard/_components/types";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "preferences", label: "Preferences", icon: Mountain },
  { id: "privacy", label: "Privacy", icon: EyeOff },
  { id: "emergency", label: "Emergency", icon: PhoneCall },
  { id: "account", label: "Account", icon: Mail },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SectionId>("profile");

  const [profile, setProfile] = useState<{
    id: string; name: string; email: string; image: string | null;
    username: string | null; homeLocation: { district: string; province: string } | null;
    preference: {
      interests: string[]; travelStyle: string[]; riskTolerance: string;
      maxDistanceKm: number | null; typicalDurationDays: number | null;
    } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Profile form
  const [draftName, setDraftName] = useState("");
  const [draftUsername, setDraftUsername] = useState("");
  const [draftProvince, setDraftProvince] = useState("");
  const [draftDistrict, setDraftDistrict] = useState("");

  // Preferences
  const [draftInterests, setDraftInterests] = useState<string[]>([]);
  const [draftTravelStyle, setDraftTravelStyle] = useState<string[]>([]);
  const [draftRiskTolerance, setDraftRiskTolerance] = useState("MEDIUM");
  const [draftMaxDistanceKm, setDraftMaxDistanceKm] = useState(300);
  const [draftTypicalDurationDays, setDraftTypicalDurationDays] = useState(3);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Privacy
  const [privacy, setPrivacy] = useState<Record<string, string> | null>(null);
  const [draftPrivacy, setDraftPrivacy] = useState<Record<string, string>>({});

  const [loggingOut, setLoggingOut] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const [dashboardRes, privacyRes] = await Promise.all([
        fetch("/api/dashboard", { credentials: "include" }),
        fetch("/api/user/privacy", { credentials: "include" }),
      ]);
      if (!dashboardRes.ok) { router.push("/sign-in"); return; }
      const data = await dashboardRes.json();
      setProfile({
        id: data.user.id, name: data.user.name, email: data.user.email,
        image: data.user.image, username: data.user.username,
        homeLocation: data.user.homeLocation,
        preference: data.user.preference,
      });
      if (privacyRes.ok) {
        const pData = await privacyRes.json();
        setPrivacy(pData);
        setDraftPrivacy(pData);
      }
    } catch {} finally { setLoading(false); }
  }, [router]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  function initDrafts(section: SectionId) {
    if (section === "profile") {
      setDraftName(profile?.name ?? "");
      setDraftUsername(profile?.username ?? "");
      setDraftProvince(profile?.homeLocation?.province ?? "");
      setDraftDistrict(profile?.homeLocation?.district ?? "");
    }
    if (section === "preferences") {
      setDraftInterests(profile?.preference?.interests ?? []);
      setDraftTravelStyle(profile?.preference?.travelStyle ?? []);
      setDraftRiskTolerance(profile?.preference?.riskTolerance ?? "MEDIUM");
      setDraftMaxDistanceKm(profile?.preference?.maxDistanceKm ?? 300);
      setDraftTypicalDurationDays(profile?.preference?.typicalDurationDays ?? 3);
    }
    if (section === "security") {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    }
    if (section === "privacy") {
      setDraftPrivacy(privacy ?? {});
    }
  }

  function switchSection(id: SectionId) {
    setSaveError(null); setSuccessMsg(null); setPasswordError(null);
    setActiveSection(id);
    initDrafts(id);
  }

  async function saveProfileSection() {
    setSaving(true); setSaveError(null); setSuccessMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (activeSection === "profile") {
        body.name = draftName.trim();
        body.username = draftUsername.trim();
        body.province = draftProvince;
        body.district = draftDistrict;
      }
      if (activeSection === "preferences") {
        body.interests = draftInterests;
        body.travelStyle = draftTravelStyle;
        body.riskTolerance = draftRiskTolerance;
        body.maxDistanceKm = draftMaxDistanceKm;
        body.typicalDurationDays = draftTypicalDurationDays;
      }
      if (activeSection === "privacy") {
        const privacyRes = await fetch("/api/user/privacy", {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftPrivacy),
        });
        const pData = await privacyRes.json();
        if (!privacyRes.ok) { setSaveError(pData.message ?? "Save failed."); setSaving(false); return; }
        setPrivacy(pData);
        setSuccessMsg("Privacy settings saved.");
        setTimeout(() => setSuccessMsg(null), 3000);
        setSaving(false);
        return;
      }
      const res = await fetch("/api/user/profile", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.message ?? "Save failed."); return; }
      await fetchProfile();
      setSuccessMsg("Saved successfully.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setSaveError(String(err));
    } finally { setSaving(false); }
  }

  async function handleChangePassword() {
    setPasswordError(null); setSaveError(null); setSuccessMsg(null);
    if (!currentPassword) { setPasswordError("Current password is required."); return; }
    if (newPassword.length < 6) { setPasswordError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("Passwords do not match."); return; }
    setSaving(true);
    try {
      await authClient.changePassword({ currentPassword, newPassword });
      setSuccessMsg("Password changed successfully.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setPasswordError(err?.message ?? err?.status ?? "Failed to change password.");
    } finally { setSaving(false); }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await authClient.signOut();
    router.push("/sign-in");
  }

  if (loading) return (
    <AppShell active="more" title="Settings">
      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-40 bg-slate-800 rounded" />
        <div className="h-64 bg-slate-800/60 rounded-xl" />
      </div>
    </AppShell>
  );

  const riskLabelMap: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

  function renderContent() {
    switch (activeSection) {
      case "profile": return renderProfile();
      case "security": return renderSecurity();
      case "preferences": return renderPreferences();
      case "emergency": return renderEmergency();
      case "privacy": return renderPrivacy();
      case "account": return renderAccount();
    }
  }

  function renderProfile() {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Profile</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Your name, username, and home location</p>

        <div className="flex items-center gap-4 p-4 rounded-xl border border-slate-700/50 bg-slate-800/60">
          <PhotoUpload
            currentImage={profile?.image ?? null}
            name={profile?.name ?? ""}
            onUploaded={(url) => { setProfile((p) => p ? { ...p, image: url } : p); setSuccessMsg("Photo updated."); setTimeout(() => setSuccessMsg(null), 3000); }}
          />
          <div>
            <p className="font-body text-sm text-white font-medium">{profile?.name}</p>
            {profile?.username && <p className="font-body text-xs text-amber-400/80">@{profile.username}</p>}
            <p className="font-body text-xs text-slate-500">{profile?.email}</p>
          </div>
        </div>

        <div>
          <label className="font-body text-xs text-slate-500 mb-1.5 block">Display name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Your name"
            className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50" />
        </div>

        <div>
          <label className="font-body text-xs text-slate-500 mb-1.5 block">Username</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-body text-sm">@</span>
            <input value={draftUsername} onChange={(e) => setDraftUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="your_username"
              className="w-full pl-7 pr-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50" />
          </div>
          <p className="text-xs text-slate-600 font-body mt-1">Letters, numbers, underscores only</p>
        </div>

        <div>
          <label className="font-body text-xs text-slate-500 mb-1.5 block">Home location</label>
          <div className="grid grid-cols-2 gap-3">
            <select value={draftProvince} onChange={(e) => { setDraftProvince(e.target.value); setDraftDistrict(""); }}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50">
              <option value="">Province</option>
              {Object.keys(PROVINCES).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={draftDistrict} onChange={(e) => setDraftDistrict(e.target.value)} disabled={!draftProvince}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50 disabled:opacity-40">
              <option value="">District</option>
              {draftProvince && PROVINCES[draftProvince]?.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          {saveError && <p className="text-red-400 text-xs font-body flex-1 self-center">{saveError}</p>}
          <button onClick={() => { initDrafts("profile"); setSuccessMsg(null); setSaveError(null); }}
            className="px-4 py-2 rounded-lg border border-slate-700/50 text-slate-400 hover:text-white transition-all font-body text-sm">
            Reset
          </button>
          <button onClick={saveProfileSection} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-body font-semibold transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  function renderSecurity() {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Security</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Change your password</p>

        <div className="p-4 rounded-xl border border-slate-700/50 bg-slate-800/60 space-y-4">
          <div>
            <label className="font-body text-xs text-slate-500 mb-1.5 block">Current password</label>
            <input type="password" value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50" />
          </div>
          <div>
            <label className="font-body text-xs text-slate-500 mb-1.5 block">New password</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters"
                className="w-full px-3 py-2.5 pr-9 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="font-body text-xs text-slate-500 mb-1.5 block">Confirm new password</label>
            <input type={showPassword ? "text" : "password"} value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showPassword} onChange={() => setShowPassword(!showPassword)}
              className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30" />
            <span className="font-body text-xs text-slate-500">Show passwords</span>
          </label>
          {passwordError && <p className="text-red-400 text-xs font-body">{passwordError}</p>}
        </div>

        <div className="flex justify-end gap-3">
          {saveError && <p className="text-red-400 text-xs font-body flex-1 self-center">{saveError}</p>}
          <button onClick={handleChangePassword} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-body font-semibold transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>
      </div>
    );
  }

  function renderPreferences() {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Preferences</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Travel style, risk tolerance, and destination preferences</p>

        <div className="p-4 rounded-xl border border-slate-700/50 bg-slate-800/60 space-y-4">
          <div>
            <label className="font-body text-xs text-slate-500 mb-2 block">Risk Tolerance</label>
            <select value={draftRiskTolerance} onChange={(e) => setDraftRiskTolerance(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50">
              <option value="LOW">Low — Only safe destinations</option>
              <option value="MEDIUM">Medium — Balanced</option>
              <option value="HIGH">High — Thrill-seeker</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-body text-xs text-slate-500 mb-2 block">Typical trip duration</label>
              <select value={draftTypicalDurationDays} onChange={(e) => setDraftTypicalDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50">
                <option value={1}>1 Day</option>
                <option value={2}>2 Days</option>
                <option value={3}>3 Days</option>
                <option value={5}>5 Days</option>
                <option value={7}>1 Week</option>
                <option value={14}>2 Weeks+</option>
              </select>
            </div>
            <div>
              <label className="font-body text-xs text-slate-500 mb-2 block">Max travel distance</label>
              <select value={draftMaxDistanceKm} onChange={(e) => setDraftMaxDistanceKm(Number(e.target.value))}
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50">
                <option value={50}>50 km</option>
                <option value={100}>100 km</option>
                <option value={300}>300 km</option>
                <option value={500}>500 km</option>
                <option value={1000}>Any distance</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          {saveError && <p className="text-red-400 text-xs font-body flex-1 self-center">{saveError}</p>}
          <button onClick={saveProfileSection} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-body font-semibold transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </div>
    );
  }

  function renderEmergency() {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Emergency</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Emergency contacts and hotlines</p>

        <Link href="/settings/emergency"
          className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-slate-700/50 bg-slate-800/60 hover:border-amber-400/20 hover:bg-amber-400/5 transition-all group">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-400/10 flex items-center justify-center shrink-0">
              <PhoneCall size={16} className="text-amber-400" />
            </div>
            <div>
              <p className="font-body text-sm text-white font-medium">Emergency Contacts</p>
              <p className="font-body text-xs text-slate-500">Manage your emergency contacts</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-slate-600 group-hover:text-amber-400 transition-colors shrink-0" />
        </Link>

        <div className="p-4 rounded-xl border border-slate-700/50 bg-slate-800/60">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-xs text-white font-semibold mb-1">In an emergency?</p>
              <p className="font-body text-xs text-slate-400 leading-relaxed">
                Call <strong className="text-white">100</strong> (Police),{" "}
                <strong className="text-white">102</strong> (Ambulance), or{" "}
                <strong className="text-white">1144</strong> (Tourist Police).
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPrivacy() {
    const fields = [
      { key: "whoCanSeeName", label: "Who can see your name" },
      { key: "whoCanSeeUsername", label: "Who can see your username" },
      { key: "whoCanSeeLocation", label: "Who can see your location" },
      { key: "whoCanSeeEmail", label: "Who can see your email" },
      { key: "whoCanSeeTrips", label: "Who can see your completed trips" },
      { key: "whoCanSeePhotos", label: "Who can see your trip photos" },
    ];

    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Privacy</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Control who can see your profile information</p>

        <div className="p-4 rounded-xl border border-slate-700/50 bg-slate-800/60 space-y-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="font-body text-xs text-slate-500 mb-1.5 block">{f.label}</label>
              <select
                value={draftPrivacy[f.key] ?? "everyone"}
                onChange={(e) => setDraftPrivacy((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50"
              >
                <option value="everyone">Everyone</option>
                <option value="friends_only">Friends only</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          {saveError && <p className="text-red-400 text-xs font-body flex-1 self-center">{saveError}</p>}
          <button
            onClick={() => setDraftPrivacy(privacy ?? {})}
            className="px-4 py-2 rounded-lg border border-slate-700/50 text-slate-400 hover:text-white transition-all font-body text-sm"
          >
            Reset
          </button>
          <button onClick={saveProfileSection} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-body font-semibold transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving…" : "Save privacy"}
          </button>
        </div>
      </div>
    );
  }

  function renderAccount() {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-bold text-white">Account</h2>
        <p className="font-body text-sm text-slate-500 -mt-3">Your account details</p>

        <div className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-slate-700/50 bg-slate-800/60">
          <div className="flex items-center gap-3">
            <Mail size={14} className="text-slate-500" />
            <div>
              <p className="font-body text-xs text-slate-500">Email</p>
              <p className="font-body text-sm text-white">{profile?.email}</p>
            </div>
          </div>
          <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">Verified</span>
        </div>

        <button onClick={handleLogout} disabled={loggingOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border border-slate-700/50 hover:border-red-400/30 hover:bg-red-400/5 transition-all text-slate-500 hover:text-red-400 font-body text-sm">
          {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <AppShell active="more" title="Settings">
      <div className="px-6 pt-6 pb-20 md:px-10 md:pt-10">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white transition-all">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Settings</h1>
            <p className="font-body text-sm text-slate-500 mt-0.5">Manage your account and preferences</p>
          </div>
        </div>

        {successMsg && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-body flex items-center gap-2">
            <Check size={13} /> {successMsg}
          </div>
        )}

        {/* Mobile section tabs */}
        <div className="flex md:hidden gap-1.5 overflow-x-auto mb-6 pb-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            return (
              <button key={s.id} onClick={() => switchSection(s.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-body font-medium transition-all ${
                  isActive ? "bg-amber-400/10 text-amber-400 border border-amber-400/20" : "text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/50"
                }`}>
                <Icon size={13} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Desktop: sidebar + content */}
        <div className="flex gap-8 max-w-4xl mx-auto">
          {/* Sidebar — desktop only */}
          <nav className="hidden md:flex flex-col gap-1 w-48 shrink-0">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => switchSection(s.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-body text-left transition-all ${
                    isActive
                      ? "bg-amber-400/10 text-amber-400 border border-amber-400/20 font-semibold"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent"
                  }`}>
                  <Icon size={16} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {renderContent()}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
