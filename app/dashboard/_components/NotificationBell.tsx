"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { HazardNotif } from "./types";
import { NotificationPanel } from "./NotificationPanel";

function filterHazardNotifs(notifs: HazardNotif[]): HazardNotif[] {
  return notifs;
}

export function NotificationBell({ onTripAction }: {
  onTripAction?: (n: HazardNotif) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifs] = useState<HazardNotif[]>([]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const json = await res.json();
      if (Array.isArray(json)) {
        setNotifs(filterHazardNotifs(json));
      }
    } catch {}
  }

  useEffect(() => {
    fetchNotifications();
    const iv = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(iv);
  }, []);

  function markRead(id: string) {
    setNotifs((p) => p.map((n) => n.id === id ? { ...n, read: true } : n));
    fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" }).catch(() => {});
  }

  function markAllRead() {
    setNotifs((p) => p.map((n) => ({ ...n, read: true })));
    fetch("/api/notifications/read-all", { method: "POST", credentials: "include" }).catch(() => {});
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Hazard alerts"
      >
        <Bell size={16} className={unreadCount > 0 ? "text-amber-400" : "text-slate-400"} />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      <NotificationPanel
        open={open} onClose={() => setOpen(false)}
        notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead}
        onNotificationClick={(n) => { setOpen(false); onTripAction?.(n); }}
      />
    </>
  );
}
