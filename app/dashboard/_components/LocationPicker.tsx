"use client";

import { useState, useEffect, useRef } from "react";
import { Search, MapPin, X, Loader2, Navigation } from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

interface LocationResult {
  id: string;
  name: string;
  district: string;
  province: string;
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  onSelect: (loc: LocationResult) => void;
  onClose: () => void;
  initialQuery?: string;
}

export function LocationPicker({ onSelect, onClose, initialQuery = "" }: LocationPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/destinations/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose location"
        className="fixed inset-x-4 top-20 z-[110] mx-auto w-full max-w-lg"
      >
        <div className="bg-slate-900 border border-amber-500/30 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl">
          <div className="flex items-center gap-2 p-3 border-b border-white/10">
            <Search size={16} className="text-amber-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search city, town, or chowk in Nepal..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
            />
            {query && (
              <button onClick={() => setQuery("")} className="p-1 hover:bg-white/5 rounded-md text-slate-500 hover:text-white transition-colors">
                <X size={14} />
              </button>
            )}
            <button onClick={onClose} className="text-xs font-body font-semibold text-slate-400 hover:text-white px-2 py-1">
              Cancel
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto py-1 scrollbar-hide">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-amber-400 animate-spin" />
              </div>
            )}

            {!loading && query.length >= 2 && results.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-500 font-body">No places found matching &quot;{query}&quot;</p>
              </div>
            )}

            {!loading && results.map((res) => (
              <button
                key={res.id}
                type="button"
                onClick={() => onSelect(res)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-500/10 text-left transition-colors border-b border-white/5 last:border-0 group"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-colors">
                  <MapPin size={14} className="text-slate-400 group-hover:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{res.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{res.district}, {res.province} Province</p>
                </div>
                <Navigation size={12} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}

            {query.length < 2 && (
              <div className="px-4 py-6 text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 mb-3">
                  <Search size={18} className="text-slate-500" />
                </div>
                <p className="text-xs text-slate-400 font-body max-w-[200px] mx-auto">Type at least 2 characters to search for locations in Nepal.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
