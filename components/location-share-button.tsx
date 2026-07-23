"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Share2, X, Loader2,
  Clock, StopCircle, Search, Check,
} from "lucide-react";
import { useLocationShare } from "@/lib/hooks/useLocationShare";
import { OverlayPortal } from "@/components/overlay-portal";

interface Friend {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

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

  const [showPicker, setShowPicker] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sharingStarted, setSharingStarted] = useState(false);

  const openPicker = useCallback(async () => {
    setShowPicker(true);
    setLoadingFriends(true);
    try {
      const res = await fetch("/api/friends", { credentials: "include" });
      if (res.ok) {
        const all = await res.json();
        setFriends(all.filter((f: any) => f.status === "ACCEPTED"));
      }
    } catch {
      // silently fail
    } finally {
      setLoadingFriends(false);
    }
  }, []);

  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleShare = async () => {
    setSharingStarted(true);
    try {
      await startSharing(Array.from(selectedIds));
      setShowPicker(false);
    } catch {
      setSharingStarted(false);
    }
  };

  const filtered = search.trim()
    ? friends.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : friends;

  // Sharing active — show live card with stop button, no URL
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
        </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`rounded-xl border border-red-500/20 bg-red-500/5 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <X size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm text-red-300">{error}</p>
          </div>
          <button
            onClick={() => openPicker()}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-all text-xs font-body font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={openPicker}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 text-amber-400 transition-all font-body text-sm font-medium ${className}`}
      >
        <Share2 size={15} />
        Share Live Location
      </button>

      {/* Friend picker modal */}
      {showPicker && (
        <OverlayPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => !sharingStarted && setShowPicker(false)} />
            <div className="relative w-full max-w-sm mx-4 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <h3 className="font-display font-semibold text-white text-sm">Share Live Location</h3>
              <button
                onClick={() => { if (!sharingStarted) setShowPicker(false); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-4">
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search friends..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 font-body"
                />
              </div>

              {loadingFriends ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-slate-500" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center py-8 text-xs text-slate-500 font-body">
                  {search ? "No friends match your search" : "No friends yet"}
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {filtered.map((friend) => (
                    <div
                      key={friend.id}
                      onClick={() => toggleFriend(friend.id)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/60 cursor-pointer transition-colors"
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          selectedIds.has(friend.id)
                            ? "bg-amber-500 border-amber-500"
                            : "border-slate-600 bg-slate-800"
                        }`}
                      >
                        {selectedIds.has(friend.id) && <Check size={10} className="text-slate-900" />}
                      </div>
                      <span className="font-body text-sm text-white">{friend.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-700">
              <button
                onClick={() => setShowPicker(false)}
                disabled={sharingStarted}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-all text-xs font-body font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleShare}
                disabled={selectedIds.size === 0 || sharingStarted}
                className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 transition-all text-xs font-body font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {sharingStarted ? (
                  <><Loader2 size={12} className="animate-spin" /> Starting...</>
                ) : (
                  `Share with ${selectedIds.size}`
                )}
              </button>
            </div>
          </div>
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
