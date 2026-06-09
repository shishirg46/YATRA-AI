"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Loader2, UserPlus, CheckCircle2 } from "lucide-react";

interface MemberResult {
  id: string; name: string; username: string | null; image: string | null; status: string;
}

export default function MemberSearch({ members, onChange }: {
  members: MemberResult[];
  onChange: (m: MemberResult[]) => void;
}) {
  const [q,        setQ]        = useState("");
  const [results,  setResults]  = useState<MemberResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) setResults(await res.json());
      } catch { /* silent */ } finally { setLoading(false); }
    }, 300);
  }, [q]);

  function add(u: MemberResult) {
    if (!u.username) return;
    if (members.some((m) => m.id === u.id)) return;
    onChange([...members, u]);
    setQ(""); setResults([]);
  }

  function remove(id: string) { onChange(members.filter((m) => m.id !== id)); }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
        <input type="text" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)}
          className="plan-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl"/>
        {loading
          ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin"/>
          : q ? <button onClick={() => { setQ(""); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={13}/></button>
          : null}
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((u) => {
            const added = members.some((m) => m.id === u.id);
            return (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div>
                  <p className="font-body text-sm text-white">{u.name}</p>
                  {u.username && <p className="font-body text-xs text-slate-500">@{u.username}</p>}
                </div>
                <button type="button" onClick={() => add(u)} disabled={added || !u.username}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-body font-medium transition-all ${added ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 cursor-default" : "border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>
                  {added ? <><CheckCircle2 size={11}/> Added</> : <><UserPlus size={11}/> Add</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          <p className="font-body text-xs text-slate-500 uppercase tracking-widest">Partners ({members.length})</p>
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0">
                  <span className="font-display font-bold text-amber-400 text-xs">{m.name[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-body text-sm text-white">{m.name}</p>
                  {m.username && <p className="font-body text-xs text-slate-500">@{m.username}</p>}
                </div>
              </div>
              <button type="button" onClick={() => remove(m.id)} className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                <X size={13}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && !q && (
        <p className="font-body text-xs text-slate-600 text-center py-3">
          Search for travel partners by name. Their health profiles will be included in the safety analysis.
        </p>
      )}
    </div>
  );
}
