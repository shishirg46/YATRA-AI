/**
 * FILE: ui.tsx
 * LOCATION: /app/dashboard/_components/ui.tsx
 * PURPOSE: Small reusable UI components used across the dashboard
 */
"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Camera, Upload, Loader2 } from "lucide-react";
import { LEVEL_CONFIG, Destination } from "./types";

export function SafetyBadge({ level }: { level: Destination["safetyLevel"] }) {
  const cfg  = LEVEL_CONFIG[level];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon size={11} />{cfg.label}
    </span>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#f87171";
  return (
    <div className="relative w-14 h-14 flex-shrink-0">
      <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
        <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4"/>
        <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${(score/100)*138.2} 138.2`} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display font-bold text-sm text-white">{score}</span>
      </div>
    </div>
  );
}

export function Avatar({ image, name, size = 8, className = "" }: {
  image: string | null; name: string; size?: number; className?: string;
}) {
  const px = size * 4;
  const s  = `w-${size} h-${size}`;
  if (image) {
    return (
      <Image
        src={image} alt={name} width={px} height={px}
        className={`${s} rounded-full object-cover border border-slate-700 ${className}`}
        unoptimized={image.startsWith("data:")}
      />
    );
  }
  return (
    <div className={`${s} rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0 ${className}`}>
      <span className="font-display font-bold text-amber-400" style={{ fontSize: size * 2 }}>
        {name?.[0]?.toUpperCase()}
      </span>
    </div>
  );
}

export function TimeAgo({ iso }: { iso: string }) {
  const [now] = useState<number>(() => Date.now());
  const diff  = now - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return <span>Just now</span>;
  if (mins < 60) return <span>{mins}m ago</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return <span>{hrs}h ago</span>;
  return <span>{Math.floor(hrs / 24)}d ago</span>;
}

export function PhotoUpload({ currentImage, name, onUploaded }: {
  currentImage: string | null;
  name:         string;
  onUploaded:   (url: string) => void;
}) {
  const inputRef                  = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview]     = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader  = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5 MB."); return; }
    if (!file.type.startsWith("image/")) { setError("Please choose an image file."); return; }
    setUploading(true); setError(null);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch("/api/user/avatar", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Upload failed");
      const { url } = await res.json();
      onUploaded(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  const displayed = preview ?? currentImage;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative group cursor-pointer" onClick={() => inputRef.current?.click()}>
        {displayed ? (
          <Image src={displayed} alt={name} width={80} height={80}
            className="w-20 h-20 rounded-2xl border-2 border-slate-700 object-cover transition-opacity duration-200 group-hover:opacity-60"
            unoptimized={displayed.startsWith("data:")} />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-amber-400/15 border-2 border-amber-400/25 flex items-center justify-center transition-opacity duration-200 group-hover:opacity-60">
            <span className="font-display font-bold text-3xl text-amber-400">{name?.[0]?.toUpperCase()}</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {uploading ? <Loader2 size={22} className="text-white animate-spin drop-shadow-lg" /> : <Camera size={22} className="text-white drop-shadow-lg" />}
        </div>
      </div>
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-amber-400/40 hover:bg-amber-400/5 text-slate-400 hover:text-amber-400 text-xs font-body transition-all disabled:opacity-50">
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {uploading ? "Uploading…" : "Change photo"}
      </button>
      {error && <p className="text-red-400 text-xs font-body text-center">{error}</p>}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
