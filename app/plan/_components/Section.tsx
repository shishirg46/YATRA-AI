"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Shield } from "lucide-react";

export default function Section({ title, icon: Icon, children, defaultOpen = true, accent = false }: {
  title: string; icon: typeof Shield; children: React.ReactNode; defaultOpen?: boolean; accent?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`plan-card rounded-2xl overflow-hidden ${accent ? "border-red-500/25" : ""}`}
      style={accent ? { borderColor: "rgba(239,68,68,0.25)" } : {}}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Icon size={15} className={accent ? "text-red-400" : "text-amber-400"} />
          <span className="font-display font-bold text-white text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={15} className="text-slate-500"/> : <ChevronDown size={15} className="text-slate-500"/>}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-800 space-y-3">{children}</div>}
    </div>
  );
}
