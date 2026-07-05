"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, Loader2, ArrowRight } from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import type { HazardNotif } from "./types";

interface TripReminderModalProps {
  notif: HazardNotif;
  onDismiss: () => void;
}

export function TripReminderModal({ notif, onDismiss }: TripReminderModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const daysBefore = notif.type === "TRIP_REMINDER" && "daysBefore" in notif
    ? (notif as any).daysBefore as number
    : null;

  function handleView() {
    if (!notif.planId) return;
    setLoading(true);
    router.push(`/trips/${notif.planId}`);
  }

  return (
    <OverlayPortal active={true}>
      <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={onDismiss} />
      <div className="fixed bottom-0 left-0 right-0 z-[210] md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:bottom-auto md:max-w-md w-full">
        <div className="bg-background border-t md:border border-slate-700/50 rounded-t-xl md:rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-amber-400" />
              <h2 className="font-display font-bold text-white text-lg">
                {daysBefore === 1 ? "Starts Tomorrow!" : "Trip Reminder"}
              </h2>
            </div>
            <button onClick={onDismiss} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-800">
              <X size={18} />
            </button>
          </div>

          <div className="mb-5 p-4 rounded-xl bg-amber-400/5 border border-amber-400/20">
            <p className="font-body text-sm text-slate-300 mb-1">{notif.title}</p>
            <p className="font-body text-sm text-slate-400 leading-relaxed">{notif.body}</p>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleView}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              {loading ? "Loading…" : "View Trip Details"}
            </button>
            <button
              onClick={onDismiss}
              className="w-full px-4 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 font-body text-sm transition-all"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
