/**
 * FILE: ProfileDrawer.tsx
 * LOCATION: /app/dashboard/_components/ProfileDrawer.tsx
 * PURPOSE: Right-side profile drawer with photo upload + inline field editing + health section
 */
"use client";

import { useState, useEffect } from "react";
import { X, MapPin, LogOut, Edit, Check, Loader2 } from "lucide-react";
import { Badge }  from "@/components/ui/badge";
import {
  UserProfile, HealthData,
  BLOOD_TYPES_LIST, FITNESS_LEVELS_LIST,
  CHRONIC_LIST, COMMON_ALLERGIES_LIST, PROVINCES,
} from "./types";
import { PhotoUpload } from "./ui";

type EditField = "name" | "username" | "location" | "purposes" | "emergency" | "health";

export function ProfileDrawer({ user, open, onClose, onLogout, loggingOut, onAvatarUploaded, onProfileUpdated }: {
  user:              UserProfile;
  open:              boolean;
  onClose:           () => void;
  onLogout:          () => void;
  loggingOut:        boolean;
  onAvatarUploaded:  (url: string) => void;
  onProfileUpdated:  (patch: Partial<UserProfile>) => void;
}) {
  const riskLabelMap: Record<string, string> = {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
  };

  const [editField, setEditField] = useState<EditField | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [draftName,      setDraftName]      = useState("");
  const [draftUsername,  setDraftUsername]  = useState("");
  const [draftProvince,  setDraftProvince]  = useState("");
  const [draftDistrict,  setDraftDistrict]  = useState("");
  const [draftInterests, setDraftInterests] = useState<string[]>([]);
  const [draftTravelStyle, setDraftTravelStyle] = useState<string[]>([]);
  const [draftRiskTolerance, setDraftRiskTolerance] = useState<string>("MEDIUM");
  const [draftMaxDistanceKm, setDraftMaxDistanceKm] = useState<number>(300);
  const [draftTypicalDurationDays, setDraftTypicalDurationDays] = useState<number>(3);

  const [health,            setHealth]            = useState<HealthData | null>(null);
  const [healthLoaded,      setHealthLoaded]      = useState(false);
  const [draftBloodType,    setDraftBloodType]    = useState("");
  const [draftFitness,      setDraftFitness]      = useState("MODERATE");
  const [draftMobility,     setDraftMobility]     = useState(false);
  const [draftConditions,   setDraftConditions]   = useState<string[]>([]);
  const [draftAllergies,    setDraftAllergies]    = useState<string[]>([]);
  const [draftAllergyInput, setDraftAllergyInput] = useState("");

  useEffect(() => {
    if (!open || healthLoaded) return;
    fetch("/api/user/health", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: HealthData | null) => { if (d) setHealth(d); })
      .catch(() => {})
      .finally(() => setHealthLoaded(true));
  }, [open, healthLoaded]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editField) { setEditField(null); setSaveError(null); }
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editField]);

  function openEdit(field: EditField) {
    setSaveError(null);
    if (field === "name")      setDraftName(user.name ?? "");
    if (field === "username")  setDraftUsername(user.username ?? "");
    if (field === "location") {
      setDraftProvince(user.homeLocation?.province ?? "");
      setDraftDistrict(user.homeLocation?.district ?? "");
    }
    if (field === "purposes") {
      setDraftInterests(user.preference?.interests ?? []);
      setDraftTravelStyle(user.preference?.travelStyle ?? []);
      setDraftRiskTolerance(user.preference?.riskTolerance ?? "MEDIUM");
      setDraftMaxDistanceKm(user.preference?.maxDistanceKm ?? 300);
      setDraftTypicalDurationDays(user.preference?.typicalDurationDays ?? 3);
    }
    if (field === "health") {
      setDraftBloodType(health?.bloodType ?? "");
      setDraftFitness(health?.fitnessLevel ?? "MODERATE");
      setDraftMobility(health?.mobilityLimited ?? false);
      setDraftConditions(health?.chronicConditions ?? []);
      setDraftAllergies(health?.allergies ?? []);
      setDraftAllergyInput("");
    }
    setEditField(field);
  }

  function cancelEdit() { setEditField(null); setSaveError(null); }

  function toggleHealthItem<T>(list: T[], setList: (v: T[]) => void, item: T) {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  function addDraftAllergy() {
    const val = draftAllergyInput.trim();
    if (!val) return;
    if (!draftAllergies.map((a) => a.toLowerCase()).includes(val.toLowerCase())) {
      setDraftAllergies([...draftAllergies, val]);
    }
    setDraftAllergyInput("");
  }

  async function saveEdit() {
    setSaving(true); setSaveError(null);
    try {
      if (editField === "health") {
        const finalAllergies = draftAllergyInput.trim()
          ? [...draftAllergies, draftAllergyInput.trim()] : draftAllergies;
        const res = await fetch("/api/user/health", {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bloodType: draftBloodType || null, fitnessLevel: draftFitness,
            mobilityLimited: draftMobility, chronicConditions: draftConditions,
            allergies: finalAllergies,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setSaveError(data.message ?? "Save failed."); return; }
        setHealth({ bloodType: draftBloodType || null, fitnessLevel: draftFitness as "LOW"|"MODERATE"|"HIGH", mobilityLimited: draftMobility, chronicConditions: draftConditions, allergies: finalAllergies });
        setEditField(null); return;
      }
      const body: Record<string, unknown> = {};
      if (editField === "name")      body.name = draftName.trim();
      if (editField === "username")  body.username = draftUsername.trim();
      if (editField === "location")  { body.province = draftProvince; body.district = draftDistrict; }
      if (editField === "purposes")  {
        body.interests = draftInterests;
        body.travelStyle = draftTravelStyle;
        body.riskTolerance = draftRiskTolerance;
        body.maxDistanceKm = draftMaxDistanceKm;
        body.typicalDurationDays = draftTypicalDurationDays;
      }
      const res = await fetch("/api/user/profile", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.message ?? "Save failed."); return; }
      if (editField === "name")     onProfileUpdated({ name: draftName.trim() });
      if (editField === "username") onProfileUpdated({ username: draftUsername.trim().toLowerCase().replace(/^@/, "") });
      if (editField === "location") onProfileUpdated({ homeLocation: { name: draftDistrict, district: draftDistrict, province: draftProvince } });
      if (editField === "purposes") onProfileUpdated({ preference: { ...(user.preference || { locationLat: null, locationLng: null, maxDistanceKm: null, typicalDurationDays: null }), interests: draftInterests, travelStyle: draftTravelStyle, riskTolerance: draftRiskTolerance, maxDistanceKm: draftMaxDistanceKm, typicalDurationDays: draftTypicalDurationDays } });
      setEditField(null);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  // Shared editable row layout
  function EditableRow({ label, value, field, children }: {
    label:    string; value: React.ReactNode; field: EditField; children?: React.ReactNode;
  }) {
    const isActive = editField === field;
    return (
      <div className={`rounded-xl border transition-all duration-200 ${isActive ? "border-amber-400/30 bg-amber-400/5" : "border-slate-700/50 bg-slate-800/60"}`}>
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="font-body text-xs text-slate-500 uppercase tracking-widest">{label}</span>
          {!isActive ? (
            <button onClick={() => openEdit(field)} className="p-1 rounded-lg text-slate-600 hover:text-amber-400 hover:bg-amber-400/10 transition-all" title={`Edit ${label.toLowerCase()}`}>
              <Edit size={13} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={cancelEdit} className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-all"><X size={13} /></button>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-body font-semibold transition-all disabled:opacity-50">
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
              </button>
            </div>
          )}
        </div>
        {!isActive && <div className="px-3 pb-2.5">{value}</div>}
        {isActive && (
          <div className="px-3 pb-3 space-y-2">
            {children}
            {saveError && <p className="text-red-400 text-xs font-body">{saveError}</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => { if (!editField) onClose(); }}
      />
      <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm drawer-panel transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex flex-col h-full overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-800">
            <h2 className="font-display text-lg font-bold text-white">{editField ? "Edit Profile" : "My Profile"}</h2>
            <button onClick={() => { if (editField) cancelEdit(); else onClose(); }} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"><X size={18} /></button>
          </div>

          {/* Photo + name */}
          <div className="p-6 border-b border-slate-800 flex flex-col items-center gap-3">
            <PhotoUpload currentImage={user.image} name={user.name} onUploaded={onAvatarUploaded} />
            <div className="text-center">
              <h3 className="font-display font-bold text-white text-lg">{user.name}</h3>
              {user.username && <p className="font-body text-sm text-amber-400/80 mt-0.5">@{user.username}</p>}
              <p className="font-body text-sm text-slate-400 mt-0.5">{user.email}</p>
            </div>
          </div>

          {/* Editable fields */}
          <div className="flex-1 p-5 space-y-3">

            <EditableRow label="Display name" field="name" value={<span className="font-body text-sm text-slate-200">{user.name}</span>}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Your name" className="drawer-input w-full px-3 py-2 text-sm rounded-lg" autoFocus />
            </EditableRow>

            <EditableRow label="Username" field="username" value={user.username ? <span className="font-body text-sm text-amber-400/80">@{user.username}</span> : <span className="font-body text-sm text-slate-600 italic">Not set</span>}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-body text-sm">@</span>
                <input value={draftUsername} onChange={(e) => setDraftUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="your_username" className="drawer-input w-full pl-7 pr-3 py-2 text-sm rounded-lg" autoFocus />
              </div>
              <p className="text-xs text-slate-600 font-body">Letters, numbers, underscores only</p>
            </EditableRow>

            <EditableRow label="Home location" field="location"
              value={user.homeLocation
                ? <div className="flex items-center gap-2"><MapPin size={13} className="text-amber-400 flex-shrink-0" /><span className="font-body text-sm text-slate-200">{user.homeLocation.district}, {user.homeLocation.province}</span></div>
                : <span className="font-body text-sm text-slate-600 italic">Not set</span>}>
              <select value={draftProvince} onChange={(e) => { setDraftProvince(e.target.value); setDraftDistrict(""); }} className="drawer-input w-full px-3 py-2 text-sm rounded-lg">
                <option value="">Select province</option>
                {Object.keys(PROVINCES).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {draftProvince && (
                <select value={draftDistrict} onChange={(e) => setDraftDistrict(e.target.value)} className="drawer-input w-full px-3 py-2 text-sm rounded-lg">
                  <option value="">Select district</option>
                  {PROVINCES[draftProvince]?.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
            </EditableRow>

            <EditableRow label="Preferences" field="purposes"
              value={(user.preference?.interests?.length ?? 0) > 0 || (user.preference?.travelStyle?.length ?? 0) > 0
                ? <div className="space-y-2 pt-0.5">
                    <div className="flex flex-wrap gap-1.5">
                      {user.preference?.riskTolerance && (
                        <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/25 font-body text-xs px-2.5 py-0.5">
                          Risk: {riskLabelMap[user.preference.riskTolerance] ?? user.preference.riskTolerance}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(new Set(user.preference?.interests ?? [])).map((p) => (
                        <Badge key={p} className="bg-sky-400/10 text-sky-400 border-sky-400/20 font-body text-xs px-2.5 py-0.5 capitalize">
                          {p.replace(/_/g, " ")}
                        </Badge>
                      ))}
                      {Array.from(new Set((user.preference?.travelStyle ?? []).filter((p) => !(user.preference?.interests ?? []).includes(p)))).map((p) => (
                        <Badge key={p} className="bg-violet-400/10 text-violet-300 border-violet-400/20 font-body text-xs px-2.5 py-0.5 capitalize">
                          {p.replace(/_/g, " ")}
                        </Badge>
                      ))}
                      {user.preference?.typicalDurationDays && <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 font-body text-xs px-2.5 py-0.5">{user.preference.typicalDurationDays} days</Badge>}
                      {user.preference?.maxDistanceKm && <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 font-body text-xs px-2.5 py-0.5">{user.preference.maxDistanceKm === 1000 ? "Any distance" : `${user.preference.maxDistanceKm} km`}</Badge>}
                    </div>
                  </div>
                : <span className="font-body text-sm text-slate-600 italic">Not set</span>}>
              <div className="space-y-4">
                <div>
                  <p className="font-body text-xs text-slate-500 mb-2">Risk Tolerance</p>
                  <select value={draftRiskTolerance} onChange={(e) => setDraftRiskTolerance(e.target.value)} className="drawer-input w-full px-3 py-2 text-sm rounded-lg">
                    <option value="LOW">Low - Only safe areas</option>
                    <option value="MEDIUM">Medium - Balanced</option>
                    <option value="HIGH">High - Thrill-seeker</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="font-body text-xs text-slate-500 mb-2">Duration</p>
                    <select value={draftTypicalDurationDays} onChange={(e) => setDraftTypicalDurationDays(Number(e.target.value))} className="drawer-input w-full px-3 py-2 text-sm rounded-lg">
                      <option value={1}>1 Day (Trip)</option>
                      <option value={2}>2 Days (Weekend)</option>
                      <option value={3}>3 Days</option>
                      <option value={5}>5 Days</option>
                      <option value={7}>1 Week</option>
                      <option value={14}>2 Weeks+</option>
                    </select>
                  </div>
                  <div>
                    <p className="font-body text-xs text-slate-500 mb-2">Max Distance</p>
                    <select value={draftMaxDistanceKm} onChange={(e) => setDraftMaxDistanceKm(Number(e.target.value))} className="drawer-input w-full px-3 py-2 text-sm rounded-lg">
                      <option value={50}>50 km (Local)</option>
                      <option value={100}>100 km</option>
                      <option value={300}>300 km (Regional)</option>
                      <option value={500}>500 km</option>
                      <option value={1000}>Any distance</option>
                    </select>
                  </div>
                </div>
              </div>
            </EditableRow>

            <EditableRow label="Health profile" field="health"
              value={health
                ? <div className="space-y-1.5 pt-0.5">
                    {health.bloodType && <div className="flex items-center justify-between"><span className="font-body text-xs text-slate-500">Blood type</span><span className="font-body text-sm text-rose-300">{health.bloodType}</span></div>}
                    <div className="flex items-center justify-between"><span className="font-body text-xs text-slate-500">Fitness</span><span className="font-body text-sm text-slate-200 capitalize">{health.fitnessLevel.toLowerCase()}</span></div>
                    {health.mobilityLimited && <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400/60" /><span className="font-body text-xs text-amber-400/80">Mobility limited</span></div>}
                    {health.chronicConditions.length > 0 && <div className="flex flex-wrap gap-1 pt-0.5">{health.chronicConditions.map((c) => <span key={c} className="px-2 py-0.5 rounded-full bg-orange-400/10 border border-orange-400/20 text-orange-300 font-body text-[10px]">{CHRONIC_LIST.find((x) => x.id === c)?.label ?? c}</span>)}</div>}
                    {health.allergies.length > 0 && <div className="flex flex-wrap gap-1 pt-0.5">{health.allergies.map((a) => <span key={a} className="px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/40 text-slate-300 font-body text-[10px]">{a}</span>)}</div>}
                  </div>
                : <span className="font-body text-sm text-slate-600 italic">Not set</span>}>
              {/* Blood type */}
              <div className="grid gap-1.5">
                <span className="font-body text-xs text-slate-500">Blood type</span>
                <div className="flex flex-wrap gap-1.5">
                  {BLOOD_TYPES_LIST.map((bt) => (
                    <button key={bt} type="button" onClick={() => setDraftBloodType(draftBloodType === bt ? "" : bt)}
                      className={`px-2.5 py-1 rounded-full border text-xs font-body transition-all ${draftBloodType === bt ? "bg-rose-400/15 border-rose-400/40 text-rose-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
                      {bt}
                    </button>
                  ))}
                </div>
              </div>
              {/* Fitness */}
              <div className="grid gap-1.5">
                <span className="font-body text-xs text-slate-500">Fitness level</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {FITNESS_LEVELS_LIST.map((f) => (
                    <button key={f.id} type="button" onClick={() => setDraftFitness(f.id)}
                      className={`flex flex-col items-center py-2 px-1 rounded-xl border text-center transition-all ${draftFitness === f.id ? "bg-amber-400/12 border-amber-400/40 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
                      <span className="text-base mb-0.5">{f.emoji}</span>
                      <span className="font-body text-[10px] font-medium">{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Mobility */}
              <div className="flex items-center justify-between py-1">
                <span className="font-body text-xs text-slate-400">Mobility limited</span>
                <button type="button" onClick={() => setDraftMobility((v) => !v)} className={`toggle-track ${draftMobility ? "on" : ""}`}>
                  <div className="toggle-knob" />
                </button>
              </div>
              {/* Conditions */}
              <div className="grid gap-1.5">
                <span className="font-body text-xs text-slate-500">Chronic conditions</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {CHRONIC_LIST.map((c) => {
                    const active = draftConditions.includes(c.id);
                    return (
                      <button key={c.id} type="button" onClick={() => toggleHealthItem(draftConditions, setDraftConditions, c.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-left transition-all ${active ? "bg-orange-400/10 border-orange-400/30 text-orange-300" : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                        <span className="text-sm leading-none">{c.icon}</span>
                        <span className="font-body text-[10px] font-medium leading-tight">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Allergies */}
              <div className="grid gap-1.5">
                <span className="font-body text-xs text-slate-500">Allergies</span>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_ALLERGIES_LIST.map((a) => {
                    const active = draftAllergies.map((x) => x.toLowerCase()).includes(a.toLowerCase());
                    return (
                      <button key={a} type="button"
                        onClick={() => { if (active) setDraftAllergies(draftAllergies.filter((x) => x.toLowerCase() !== a.toLowerCase())); else setDraftAllergies([...draftAllergies, a]); }}
                        className={`px-2.5 py-1 rounded-full border text-[10px] font-body transition-all ${active ? "bg-amber-400/12 border-amber-400/40 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
                        {a}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1.5">
                  <input value={draftAllergyInput} onChange={(e) => setDraftAllergyInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraftAllergy(); } }}
                    placeholder="Other allergy…" className="drawer-input flex-1 px-2.5 py-1.5 text-xs rounded-lg" />
                  <button type="button" onClick={addDraftAllergy} disabled={!draftAllergyInput.trim()}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-body transition-colors disabled:opacity-40">Add</button>
                </div>
                {draftAllergies.filter((a) => !COMMON_ALLERGIES_LIST.map((x) => x.toLowerCase()).includes(a.toLowerCase())).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {draftAllergies.filter((a) => !COMMON_ALLERGIES_LIST.map((x) => x.toLowerCase()).includes(a.toLowerCase())).map((a) => (
                      <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/40 text-[10px] text-slate-300 font-body">
                        {a}<button type="button" onClick={() => setDraftAllergies(draftAllergies.filter((x) => x !== a))} className="text-slate-500 hover:text-red-400 transition-colors">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </EditableRow>

          </div>

          {/* Footer */}
          <div className="p-5 border-t border-slate-800">
            <button onClick={onLogout} disabled={loggingOut}
              className="w-full flex items-center px-4 py-3 rounded-xl border border-slate-700/50 hover:border-red-400/30 hover:bg-red-400/5 transition-all text-slate-500 hover:text-red-400 gap-2">
              <LogOut size={14} /><span className="font-body text-sm">{loggingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
