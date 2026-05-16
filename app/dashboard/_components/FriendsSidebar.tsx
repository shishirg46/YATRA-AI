/**
 * FILE: FriendsSidebar.tsx
 * LOCATION: /app/dashboard/_components/FriendsSidebar.tsx
 * PURPOSE: Slide-in friends panel from the left — list, requests, search
 */
"use client";

import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

import { useState, useEffect, useRef } from "react";
import {
  Users, X, Loader2, UserMinus, UserCheck,
  Check, UserPlus, Search,
} from "lucide-react";
import { Friend, UserSearchResult } from "./types";
import { Avatar } from "./ui";

export function FriendsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab]                       = useState<"friends" | "requests" | "search">("friends");
  const [friends, setFriends]               = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState<UserSearchResult[]>([]);
  const [searching, setSearching]           = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingId, setLoadingId]           = useState<string | null>(null);
  const searchTimer                         = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accepted        = friends.filter((f) => f.status === "ACCEPTED");
  const pendingSent     = friends.filter((f) => f.status === "PENDING_SENT");
  const pendingIncoming = friends.filter((f) => f.status === "PENDING_RECEIVED");

  useEffect(() => { if (open) loadFriends(); }, [open]);

  async function loadFriends() {
    setLoadingFriends(true);
    try {
      const res = await fetch("/api/friends", { credentials: "include" });
      if (res.ok) setFriends(await res.json());
    } catch { /* silent */ } finally { setLoadingFriends(false); }
  }

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" });
        if (res.ok) setSearchResults(await res.json());
      } catch { /* silent */ } finally { setSearching(false); }
    }, 400);
  }, [searchQuery]);

  async function sendRequest(userId: string) {
    setLoadingId(userId);
    try {
      await fetch("/api/friends/request", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: userId }),
      });
      setSearchResults((prev) => prev.map((u) => u.id === userId ? { ...u, status: "PENDING_SENT" as const } : u));
      await loadFriends();
    } catch { /* silent */ } finally { setLoadingId(null); }
  }

  async function respondRequest(friendshipId: string, action: "accept" | "decline") {
    setLoadingId(friendshipId);
    try {
      await fetch("/api/friends/respond", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId, action }),
      });
      await loadFriends();
    } catch { /* silent */ } finally { setLoadingId(null); }
  }

  async function removeFriend(friendshipId: string) {
    setLoadingId(friendshipId);
    try {
      await fetch("/api/friends/remove", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId }),
      });
      await loadFriends();
    } catch { /* silent */ } finally { setLoadingId(null); }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useBodyScrollLock(open);

  return (
    <OverlayPortal active={open}>
      <div className={`fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`} onClick={onClose} aria-hidden={!open} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Travel network"
        className={`fixed top-0 left-0 z-[110] h-full w-full max-w-xs friends-panel transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-amber-400" />
              <h2 className="font-display font-bold text-white">Travel Network</h2>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"><X size={16} /></button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            {([
              { id: "friends",  label: "Friends",  badge: accepted.length },
              { id: "requests", label: "Requests", badge: pendingIncoming.length },
              { id: "search",   label: "Find",     badge: 0 },
            ] as const).map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`relative flex-1 py-3 text-xs font-body font-medium transition-colors ${tab === t.id ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                {t.label}
                {t.badge > 0 && (
                  <span className={`absolute top-2 right-3 w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${t.id === "requests" ? "bg-red-500" : "bg-slate-600"}`}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Friends tab */}
            {tab === "friends" && (
              <div className="p-4 space-y-2">
                {loadingFriends && <div className="flex justify-center py-8"><Loader2 size={24} className="text-amber-400 animate-spin" /></div>}
                {!loadingFriends && accepted.length === 0 && (
                  <div className="py-12 text-center">
                    <Users size={28} className="text-slate-700 mx-auto mb-3" />
                    <p className="font-body text-sm text-slate-600">No friends yet</p>
                    <button onClick={() => setTab("search")} className="mt-4 font-body text-xs text-amber-400 hover:text-amber-300 transition-colors">Find travellers →</button>
                  </div>
                )}
                {accepted.map((f) => (
                  <div key={f.id} className="friend-card flex items-center gap-3 p-3 rounded-xl">
                    <Avatar image={f.image} name={f.name} size={9} />
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">{f.name}</p>
                      {f.username && <p className="font-body text-xs text-slate-500">@{f.username}</p>}
                    </div>
                    <button onClick={() => removeFriend(f.friendshipId)} disabled={loadingId === f.friendshipId}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                      {loadingId === f.friendshipId ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
                    </button>
                  </div>
                ))}
                {pendingSent.length > 0 && (
                  <>
                    <p className="font-body text-xs text-slate-600 uppercase tracking-widest pt-3 pb-1 px-1">Sent requests</p>
                    {pendingSent.map((f) => (
                      <div key={f.id} className="friend-card flex items-center gap-3 p-3 rounded-xl opacity-60">
                        <Avatar image={f.image} name={f.name} size={9} />
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm font-medium text-white truncate">{f.name}</p>
                          <p className="font-body text-xs text-amber-400/70">Request sent</p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Requests tab */}
            {tab === "requests" && (
              <div className="p-4 space-y-3">
                {pendingIncoming.length === 0 ? (
                  <div className="py-12 text-center">
                    <UserCheck size={28} className="text-slate-700 mx-auto mb-3" />
                    <p className="font-body text-sm text-slate-600">No pending requests</p>
                  </div>
                ) : pendingIncoming.map((f) => (
                  <div key={f.id} className="friend-card p-3 rounded-xl">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar image={f.image} name={f.name} size={9} />
                      <div className="flex-1 min-w-0">
                        <p className="font-body text-sm font-medium text-white truncate">{f.name}</p>
                        {f.username && <p className="font-body text-xs text-slate-500">@{f.username}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => respondRequest(f.friendshipId, "accept")} disabled={loadingId === f.friendshipId}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25 text-xs font-body font-medium transition-all">
                        {loadingId === f.friendshipId ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Accept
                      </button>
                      <button onClick={() => respondRequest(f.friendshipId, "decline")} disabled={loadingId === f.friendshipId}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-body font-medium transition-all">
                        <X size={12} />Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search tab */}
            {tab === "search" && (
              <div className="p-4">
                <div className="relative mb-4">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="text" placeholder="Search by username…" value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl" autoFocus />
                  {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />}
                  {!searching && searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={14} /></button>
                  )}
                </div>
                {searchQuery && !searching && searchResults.length === 0 && (
                  <p className="text-center font-body text-sm text-slate-600 py-8">No users found for &quot;{searchQuery}&quot;</p>
                )}
                <div className="space-y-2">
                  {searchResults.map((u) => (
                    <div key={u.id} className="friend-card flex items-center gap-3 p-3 rounded-xl">
                      <Avatar image={u.image} name={u.name} size={9} />
                      <div className="flex-1 min-w-0">
                        <p className="font-body text-sm font-medium text-white truncate">{u.name}</p>
                        {u.username && <p className="font-body text-xs text-slate-500">@{u.username}</p>}
                      </div>
                      {u.status === "NONE" && (
                        <button onClick={() => sendRequest(u.id)} disabled={loadingId === u.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 text-xs font-body font-medium transition-all">
                          {loadingId === u.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Add
                        </button>
                      )}
                      {u.status === "PENDING_SENT" && <span className="font-body text-xs text-amber-400/60 italic">Sent</span>}
                      {u.status === "PENDING_RECEIVED" && (
                        <button onClick={() => setTab("requests")} className="font-body text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Respond →</button>
                      )}
                      {u.status === "ACCEPTED" && (
                        <span className="font-body text-xs text-emerald-400 flex items-center gap-1"><Check size={11} />Friends</span>
                      )}
                    </div>
                  ))}
                </div>
                {!searchQuery && (
                  <div className="py-10 text-center">
                    <Search size={28} className="text-slate-700 mx-auto mb-3" />
                    <p className="font-body text-sm text-slate-600">Type a username to search</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-800">
            <p className="font-body text-xs text-slate-700 text-center leading-relaxed">Friends share safety data for group travel planning</p>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
