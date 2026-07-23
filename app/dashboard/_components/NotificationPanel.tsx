/**
 * FILE: NotificationPanel.tsx
 * LOCATION: /app/dashboard/_components/NotificationPanel.tsx
 * PURPOSE: Dropdown hazard alert panel triggered by the bell icon in the navbar
 */
"use client";

import { useEffect } from "react";
import { Bell, X, MapPin, Clock } from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { HazardNotif, HAZARD_CONFIG } from "./types";
import { TimeAgo } from "./ui";

export function NotificationPanel({ open, onClose, notifications, onMarkRead, onMarkAllRead, onNotificationClick }: {
  open:               boolean;
  onClose:            () => void;
  notifications:      HazardNotif[];
  onMarkRead:         (id: string) => void;
  onMarkAllRead:      () => void;
  onNotificationClick?: (n: HazardNotif) => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const unread = notifications.filter((n) => !n.read).length;
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <OverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hazard alerts"
        className="fixed top-16 right-4 left-4 sm:left-auto z-[210] sm:w-full max-w-sm notif-panel max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-amber-400" />
            <h3 className="font-display font-bold text-white text-sm">Hazard Alerts</h3>
            {unread > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold font-body px-1.5 py-0.5 rounded-full leading-none">{unread}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {unread > 0 && (
              <button onClick={onMarkAllRead} className="font-body text-xs text-slate-500 hover:text-amber-400 transition-colors">
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={16} /></button>
          </div>
        </div>

        <div className="overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell size={28} className="text-slate-700 mx-auto mb-3" />
              <p className="font-body text-sm text-slate-600">No alerts right now</p>
              <p className="font-body text-xs text-slate-700 mt-1">Nepal looks safe today 🏔️</p>
            </div>
          ) : (
            notifications.map((notif) => {
              const cfg  = HAZARD_CONFIG[notif.type];
              const Icon = cfg.icon;
              const severityDot = notif.severity === "CRITICAL" ? "animate-pulse bg-red-500"
                : notif.severity === "HIGH"   ? "bg-orange-500"
                : notif.severity === "MEDIUM" ? "bg-amber-500"
                : "bg-sky-500";

              return (
                <button key={notif.id} onClick={() => { onMarkRead(notif.id); onNotificationClick?.(notif); }}
                  className={`w-full text-left px-5 py-4 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${!notif.read ? "bg-slate-800/25" : ""}`}
                >
                  <div className="flex gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
                      <Icon size={16} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <span className="font-body text-sm font-medium text-white leading-tight">{notif.title}</span>
                        {!notif.read && <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${severityDot}`} />}
                      </div>
                      <p className="font-body text-xs text-slate-400 leading-relaxed mb-1.5">{notif.body}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1 text-slate-600">
                          <MapPin size={10} /><span className="font-body text-xs">{notif.location}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <Clock size={10} /><span className="font-body text-xs"><TimeAgo iso={notif.time} /></span>
                        </div>
                        <span className={`font-body text-xs font-semibold ${
                          notif.severity === "CRITICAL" ? "text-red-400"
                          : notif.severity === "HIGH"   ? "text-orange-400"
                          : notif.severity === "MEDIUM" ? "text-amber-400"
                          : "text-slate-500"}`}>
                          {notif.severity}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </OverlayPortal>
  );
}
