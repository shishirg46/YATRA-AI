"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Loader2, X, MapPin } from "lucide-react";

interface DestinationResult {
  id: string; name: string; district: string; province: string; altitude: number | null;
  latitude?: number; longitude?: number;
}

export default function DestSearch({ value, onChange }: {
  value: DestinationResult | null; onChange: (d: DestinationResult | null) => void;
}) {
  const [q, setQ]             = useState(value?.name ?? "");
  const [results, setResults] = useState<DestinationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const timer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value?.name) setQ(value.name);
  }, [value?.name]);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() || q === value?.name) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/destinations/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) { setResults(await res.json()); setOpen(true); }
      } catch { /* silent */ } finally { setLoading(false); }
    }, 300);
  }, [q]);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" placeholder="Search destination…" value={q}
          onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && open && results.length > 0) {
              e.preventDefault();
              onChange(results[0]);
              setQ(results[0].name);
              setOpen(false);
              setResults([]);
            }
          }}
          className="plan-input w-full pl-10 pr-9 py-3 text-sm rounded-xl" required />
        {loading
          ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin"/>
          : q ? <button onClick={() => { onChange(null); setQ(""); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={14}/></button>
          : null}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[120] rounded-xl overflow-hidden shadow-2xl"
          style={{ background: "rgba(10,15,30,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {results.map((d) => (
            <button key={d.id} onClick={() => { onChange(d); setQ(d.name); setOpen(false); setResults([]); }}
              className="w-full flex items-start gap-2 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-slate-800/60 last:border-0">
              <MapPin size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-body text-sm text-white">{d.name}</p>
                <p className="font-body text-xs text-slate-500">{d.district}, {d.province}{d.altitude ? ` · ${d.altitude.toLocaleString()}m` : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
