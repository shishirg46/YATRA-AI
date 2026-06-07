import { useState } from "react";
import {
  Check, Calendar, X, Loader2, ArrowRight, Clock,
} from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import type { HazardNotif } from "@/app/dashboard/_components/types";

interface TripActionModalProps {
  notif: HazardNotif;
  onClose: () => void;
  onAction: (action: string, newDate?: string) => Promise<void>;
}

export function TripActionModal({ notif, onClose, onAction }: TripActionModalProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isStart = notif.type === "TRIP_START";
  async function handleAction(action: string, date?: string) {
    setActionLoading(action);
    setError(null);
    try {
      await onAction(action, date);
    } catch (e) {
      setError(String(e));
      setActionLoading(null);
    }
  }

  return (
    <OverlayPortal active={true}>
      <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[210] md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:bottom-auto md:max-w-md w-full">
        <div className="bg-background border-t md:border border-slate-700/50 rounded-t-xl md:rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">{isStart ? "🎒" : "✅"}</span>
              <h2 className="font-display font-bold text-white text-lg">
                {isStart ? "Start your trip?" : "Trip complete?"}
              </h2>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-800">
              <X size={18} />
            </button>
          </div>

          <p className="font-body text-sm text-slate-300 mb-5">
            {notif.body}
          </p>

          {error && (
            <p className="font-body text-xs text-red-400 mb-3">{error}</p>
          )}

          <div className="space-y-2">
            {isStart ? (
              <>
                <button
                  onClick={() => handleAction("start")}
                  disabled={actionLoading !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-body font-semibold text-sm transition-all disabled:opacity-50"
                >
                  {actionLoading === "start" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {actionLoading === "start" ? "Confirming…" : "✅ Yes, I started!"}
                </button>
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 font-body text-sm transition-all"
                >
                  <Calendar size={15} />
                  {showDatePicker ? "Cancel" : "📅 Change start date"}
                </button>
                {showDatePicker && (
                  <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 space-y-2">
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm font-body focus:outline-none focus:border-amber-400/40" />
                    <button
                      onClick={() => handleAction("change-date", newDate)}
                      disabled={!newDate || actionLoading !== null}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all disabled:opacity-50"
                    >
                      {actionLoading === "change-date" ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      {actionLoading === "change-date" ? "Saving…" : "Update date"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => handleAction("end")}
                  disabled={actionLoading !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-body font-semibold text-sm transition-all disabled:opacity-50"
                >
                  {actionLoading === "end" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {actionLoading === "end" ? "Confirming…" : "✅ Yes, trip is done!"}
                </button>
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 font-body text-sm transition-all"
                >
                  <Clock size={15} />
                  {showDatePicker ? "Cancel" : "⏱ Extend trip"}
                </button>
                {showDatePicker && (
                  <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 space-y-2">
                    <label className="font-body text-xs text-slate-500 block">New end date</label>
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm font-body focus:outline-none focus:border-amber-400/40" />
                    <button
                      onClick={() => handleAction("extend", newDate)}
                      disabled={!newDate || actionLoading !== null}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all disabled:opacity-50"
                    >
                      {actionLoading === "extend" ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      {actionLoading === "extend" ? "Saving…" : "Extend trip"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <button onClick={onClose} className="w-full mt-3 px-4 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 font-body text-sm transition-all">
            Dismiss
          </button>
        </div>
      </div>
    </OverlayPortal>
  );
}
