"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle, X, Loader2, CheckCircle, Settings,
  PhoneCall, ChevronUp,
} from "lucide-react";

type SOSState = "idle" | "confirming" | "sending" | "sent" | "error" | "no-contacts";

const SHOW_ON_PATHS = [
  "/", "/dashboard", "/plan", "/trips",
  "/destinations/", "/settings/emergency",
  "/location/view/", "/emergency-numbers",
];

export function FloatingActions() {
  const pathname = usePathname();
  const visible = SHOW_ON_PATHS.some((p) => pathname === p || pathname.startsWith(p));

  const [menuOpen, setMenuOpen] = useState(false);
  const [sosState, setSosState] = useState<SOSState>("idle");
  const [sosError, setSosError] = useState<string | null>(null);
  const [contactCount, setContactCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  if (!visible) return null;

  const getPosition = (): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 10000,
      })
    );

  const askContacts = useCallback(async () => {
    try {
      const res = await fetch("/api/user/emergency-contacts", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : 0;
      setContactCount(count);
      setSosState(count === 0 ? "no-contacts" : "confirming");
    } catch {
      setSosState("confirming");
    }
  }, []);

  const triggerSOS = useCallback(async () => {
    setSosState("sending");
    setSosError(null);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await getPosition();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}

      const res = await fetch("/api/emergency/sos", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lng, message: "SOS! I need help." }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Failed to send SOS (${res.status})`);
      setContactCount(data.emailed ?? 0);
      setSosState("sent");
    } catch (e) {
      setSosError(e instanceof Error ? e.message : "Failed to send SOS");
      setSosState("error");
    }
  }, []);

  function resetSos() { setSosState("idle"); setSosError(null); }

  if (sosState === "sent") {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-emerald-900/90 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-4 shadow-2xl shadow-emerald-500/10 max-w-xs">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle size={20} className="text-emerald-400 shrink-0" />
            <p className="font-body text-sm text-emerald-200 font-semibold">SOS Sent</p>
          </div>
          <p className="font-body text-xs text-emerald-300/70">
            {contactCount > 0
              ? `${contactCount} emergency contact(s) notified by email.`
              : "Your emergency contacts have been notified."}
          </p>
          <button onClick={resetSos} className="mt-2 text-xs font-body text-emerald-400 hover:text-emerald-300 underline">Dismiss</button>
        </div>
      </div>
    );
  }

  if (sosState === "error") {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-red-900/90 backdrop-blur-md border border-red-500/30 rounded-2xl p-4 shadow-2xl shadow-red-500/10 max-w-xs">
          <div className="flex items-center gap-3 mb-2">
            <X size={20} className="text-red-400 shrink-0" />
            <p className="font-body text-sm text-red-200 font-semibold">Failed</p>
          </div>
          <p className="font-body text-xs text-red-300/70">{sosError || "Could not send SOS."}</p>
          <div className="flex gap-2 mt-3">
            <button onClick={resetSos} className="text-xs font-body text-red-400 hover:text-red-300 underline">Cancel</button>
            <button onClick={triggerSOS} className="text-xs font-body text-white bg-red-500 hover:bg-red-400 px-3 py-1 rounded-lg">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (sosState === "confirming" || sosState === "sending") {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-red-950/95 backdrop-blur-md border border-red-500/40 rounded-2xl p-5 shadow-2xl shadow-red-500/20 max-w-xs">
          <div className="flex items-center gap-3 mb-3">
            {sosState === "sending" ? (
              <Loader2 size={22} className="text-red-400 shrink-0 animate-spin" />
            ) : (
              <AlertTriangle size={22} className="text-red-400 shrink-0" />
            )}
            <p className="font-body text-sm text-red-200 font-bold">
              {sosState === "sending" ? "Sending SOS…" : "Confirm SOS"}
            </p>
          </div>
          <p className="font-body text-xs text-red-300/70 mb-4">
            {sosState === "sending"
              ? "Notifying your emergency contacts. Please wait."
              : "This will alert your emergency contacts with your current location."}
          </p>
          <div className="flex gap-2">
            <button onClick={resetSos} disabled={sosState === "sending"}
              className="flex-1 py-2 rounded-xl border border-slate-600 font-body text-xs text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40">
              Cancel
            </button>
            <button onClick={triggerSOS} disabled={sosState === "sending"}
              className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 font-body text-xs text-white font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60">
              {sosState === "sending" ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : "Send SOS"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sosState === "no-contacts") {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-2xl p-5 shadow-2xl max-w-xs">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle size={22} className="text-amber-400 shrink-0" />
            <p className="font-body text-sm text-white font-bold">No Emergency Contacts</p>
          </div>
          <p className="font-body text-xs text-slate-400 mb-4">
            Add at least one emergency contact before sending an SOS.
          </p>
          <div className="flex gap-2">
            <button onClick={resetSos}
              className="flex-1 py-2 rounded-xl border border-slate-600 font-body text-xs text-slate-300 hover:bg-slate-800 transition-colors">Back</button>
            <Link href="/settings/emergency" onClick={resetSos}
              className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 font-body text-xs text-slate-900 font-bold transition-colors flex items-center justify-center gap-1.5">
              <Settings size={14} /> Add Contacts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {menuOpen && (
        <div className="flex flex-col items-end gap-2 animate-fade-in">
          <Link href="/emergency-numbers"
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-800/95 backdrop-blur-md border border-slate-700/60 text-slate-300 hover:text-white hover:border-amber-500/30 shadow-lg transition-all font-body text-sm">
            <PhoneCall size={14} className="text-red-400" />
            Emergency Numbers
          </Link>
        </div>
      )}

      <div className="flex items-center gap-3">
        {menuOpen && (
          <button onClick={() => setMenuOpen(false)}
            className="w-10 h-10 rounded-full bg-slate-800/95 backdrop-blur-md border border-slate-700/60 text-slate-400 hover:text-white shadow-lg transition-all flex items-center justify-center">
            <X size={16} />
          </button>
        )}
        <button
          onClick={() => { setMenuOpen(!menuOpen); }}
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-2xl shadow-red-500/30 hover:shadow-red-500/40 transition-all hover:scale-105 active:scale-95 flex items-center justify-center relative"
          title="Emergency actions"
        >
          <AlertTriangle size={22} className={menuOpen ? "" : "animate-pulse"} />
          {!menuOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white animate-ping opacity-75" />
          )}
        </button>
      </div>

    </div>
  );
}
