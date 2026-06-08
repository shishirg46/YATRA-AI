"use client";

import { useState } from "react";
import {
  MapPin, Share2, Copy, CheckCircle2, X, Loader2,
  Navigation, Clock, StopCircle,
} from "lucide-react";
import { useLocationShare } from "@/lib/hooks/useLocationShare";

export function LocationShareButton({ tripId, className = "" }: { tripId?: string; className?: string }) {
  const {
    isSharing,
    shareSession,
    error,
    lastPush,
    gpsWeak,
    startSharing,
    stopSharing,
  } = useLocationShare({ tripId });

  const [copied, setCopied] = useState(false);

  const copyShareUrl = () => {
    if (!shareSession?.shareUrl) return;
    navigator.clipboard.writeText(shareSession.shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  if (isSharing && shareSession) {
    return (
      <div className={`rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 ${className}`}>
        <div className="flex items-center gap-3 mb-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
          </span>
          <div className="flex-1">
            <p className="font-body text-sm font-semibold text-white">Sharing live location</p>
            {lastPush && (
              <p className="font-body text-[11px] text-slate-500 flex items-center gap-1">
                <Clock size={11} />
                Updated {lastPush.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
          </div>
          <button
            onClick={stopSharing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-all text-xs font-body font-medium"
          >
            <StopCircle size={13} />
            Stop
          </button>
        </div>
        {gpsWeak && (
          <p className="text-[11px] text-amber-400/80 font-body mb-2 flex items-center gap-1">
            <Navigation size={11} />
            GPS signal is weak — location may be inaccurate
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 bg-slate-900/60 rounded-lg border border-slate-700/50 px-3 py-2 truncate">
            <span className="font-body text-xs text-slate-300 truncate block">{shareSession.shareUrl}</span>
          </div>
          <button
            onClick={copyShareUrl}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 transition-all text-xs font-body font-semibold"
          >
            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-red-500/20 bg-red-500/5 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <X size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm text-red-300">{error}</p>
          </div>
          <button
            onClick={() => startSharing().catch(() => {})}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-all text-xs font-body font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => startSharing().catch(() => {})}
      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 text-amber-400 transition-all font-body text-sm font-medium ${className}`}
    >
      <Share2 size={15} />
      Share Live Location
    </button>
  );
}
