"use client";

import { useRef, useState } from "react";
import NextImage from "next/image";
import {
  AlertTriangle, X, Check, Loader2, Navigation, MapPin,
  TriangleAlert, Droplets, Mountain, Flame, CloudRain, Trees,
  Car, HelpCircle, Image
} from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import { toast } from "sonner";

const HAZARD_TYPES = [
  { value: "ROAD_BLOCKAGE", label: "Road Blockage", icon: Car },
  { value: "FLOOD", label: "Flood", icon: Droplets },
  { value: "LANDSLIDE", label: "Landslide", icon: Mountain },
  { value: "EARTHQUAKE", label: "Earthquake", icon: TriangleAlert },
  { value: "FIRE", label: "Fire", icon: Flame },
  { value: "STORM", label: "Storm", icon: CloudRain },
  { value: "WILDFIRE", label: "Wildfire", icon: Trees },
  { value: "ACCIDENT", label: "Accident", icon: Car },
  { value: "OTHER", label: "Other", icon: HelpCircle },
];

const SEVERITIES = [
  { value: "LOW", label: "Low", color: "text-emerald-400 border-emerald-400/30" },
  { value: "MEDIUM", label: "Medium", color: "text-amber-400 border-amber-400/30" },
  { value: "HIGH", label: "High", color: "text-orange-400 border-orange-400/30" },
  { value: "CRITICAL", label: "Critical", color: "text-red-400 border-red-400/30" },
];

export function ReportHazardButton({ fab }: { fab?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hazardType, setHazardType] = useState("");
  const [severity, setSeverity] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setHazardType("");
    setSeverity("");
    setTitle("");
    setDescription("");
    setLat(null);
    setLng(null);
    setLocationError(null);
    setImageUrl(null);
    setError(null);
    setSuccess(false);
  }

  function getLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation not available.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setLocating(false); },
      () => { setLocationError("Could not get location. Enter coordinates manually?"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/hazards/upload", {
        method: "POST", credentials: "include", body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setImageUrl(data.url);
      toast.success("Photo uploaded.");
    } catch {
      setError("Failed to upload image.");
      toast.error("Failed to upload image.");
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hazardType || !severity || !title || lat === null || lng === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/hazards/reports", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hazardType, severity, title, description: description || undefined, lat, lng, imageUrl: imageUrl || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to submit.");
      }
      setSuccess(true);
      toast.success("Hazard report submitted for review!");
      setTimeout(() => { setOpen(false); reset(); }, 2000);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
      toast.error(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {fab ? (
        <button onClick={() => { reset(); setOpen(true); }}
          className="w-12 h-12 rounded-full bg-rose-500/90 hover:bg-rose-400 text-white shadow-lg shadow-rose-500/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95">
          <AlertTriangle size={20} />
        </button>
      ) : (
        <button onClick={() => { reset(); setOpen(true); }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/30 transition-all font-body text-sm">
          <AlertTriangle size={14} />
          Report Hazard
        </button>
      )}

      {open && (
        <OverlayPortal active={open}>
          <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => { if (!submitting) setOpen(false); }} />
          <div className="fixed bottom-0 left-0 right-0 z-[160] md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:bottom-auto md:max-w-lg w-full">
            <div className="bg-background border-t md:border border-slate-700/50 rounded-t-xl md:rounded-xl p-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-bold text-white text-lg flex items-center gap-2">
                  <AlertTriangle size={18} className="text-rose-400" />
                  Report Hazard
                </h2>
                <button onClick={() => { if (!submitting) setOpen(false); }} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800">
                  <X size={18} />
                </button>
              </div>

              {success ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                    <Check size={24} className="text-emerald-400" />
                  </div>
                  <p className="font-body text-emerald-400 font-semibold">Report submitted for review!</p>
                  <p className="font-body text-xs text-slate-500">An admin will review it shortly.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  {error && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-xs font-body">
                      <span>{error}</span>
                      <button type="button" onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                    </div>
                  )}

                  <div>
                    <label className="font-body text-xs text-slate-500 mb-1.5 block">Hazard Type *</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {HAZARD_TYPES.map((ht) => {
                        const Icon = ht.icon;
                        const active = hazardType === ht.value;
                        return (
                          <button key={ht.value} type="button" onClick={() => setHazardType(ht.value)}
                            className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-center transition-all ${active ? "bg-rose-400/10 border-rose-400/30 text-rose-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
                            <Icon size={16} />
                            <span className="font-body text-[10px] leading-tight">{ht.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="font-body text-xs text-slate-500 mb-1.5 block">Severity *</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {SEVERITIES.map((s) => {
                        const active = severity === s.value;
                        return (
                          <button key={s.value} type="button" onClick={() => setSeverity(s.value)}
                            className={`py-2 px-1 rounded-lg border text-center text-xs font-body font-semibold transition-all ${active ? s.color + " bg-white/5" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief title *" required
                      className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm font-body focus:outline-none focus:border-amber-400/40" />
                  </div>

                  <div>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)"
                      rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm font-body focus:outline-none focus:border-amber-400/40 resize-none" />
                  </div>

                  <div>
                    <label className="font-body text-xs text-slate-500 mb-1.5 block">Photo (optional)</label>
                    <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" />
                    {imageUrl ? (
                      <div className="relative inline-block rounded-lg overflow-hidden border border-slate-700/50">
                        <NextImage src={imageUrl} alt="Hazard photo" width={200} height={112} className="h-28 object-cover rounded-lg" unoptimized />
                        <button type="button" onClick={() => setImageUrl(null)} className="absolute top-1 right-1 p-0.5 bg-slate-900/80 rounded text-slate-400 hover:text-white"><X size={14} /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500 transition-all font-body text-sm disabled:opacity-50">
                        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
                        {uploading ? "Uploading…" : "Choose photo"}
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="font-body text-xs text-slate-500 mb-1.5 block">Location *</label>
                    {lat !== null && lng !== null ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 text-xs font-body">
                        <MapPin size={12} />
                        <span className="flex-1 truncate">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
                        <button type="button" onClick={() => { setLat(null); setLng(null); }} className="text-slate-500 hover:text-white"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={getLocation} disabled={locating}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white hover:border-slate-500 transition-all font-body text-sm disabled:opacity-50">
                          {locating ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
                          {locating ? "Getting location…" : "Use my location"}
                        </button>
                        {locationError && <span className="text-xs text-rose-400 font-body">{locationError}</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button type="submit" disabled={submitting || !hazardType || !severity || !title || lat === null || lng === null}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-sm font-body font-semibold transition-all disabled:opacity-50">
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                      {submitting ? "Submitting…" : "Submit Report"}
                    </button>
                    <button type="button" onClick={() => setOpen(false)} disabled={submitting}
                      className="px-3 py-2.5 rounded-lg border border-slate-700/50 text-slate-400 hover:text-white transition-all font-body text-sm">
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
