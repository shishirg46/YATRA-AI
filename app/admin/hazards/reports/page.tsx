"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, AlertTriangle, Check, X, Search, Loader2,
  ChevronLeft as PrevIcon, ChevronRight as NextIcon,
  Eye, MapPin, Clock, User as UserIcon
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

const HAZARD_TYPE_LABELS: Record<string, string> = {
  ROAD_BLOCKAGE: "Road Blockage", FLOOD: "Flood", LANDSLIDE: "Landslide",
  EARTHQUAKE: "Earthquake", FIRE: "Fire", STORM: "Storm",
  WILDFIRE: "Wildfire", ACCIDENT: "Accident", OTHER: "Other",
};

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "text-emerald-400 border-emerald-400/30",
  MEDIUM: "text-amber-400 border-amber-400/30",
  HIGH: "text-orange-400 border-orange-400/30",
  CRITICAL: "text-red-400 border-red-400/30",
};

type Report = {
  id: string;
  hazardType: string;
  severity: string;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  imageUrl: string | null;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
  moderator: { id: string; name: string } | null;
  moderatedAt: string | null;
};

export default function AdminHazardReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalReports, setTotalReports] = useState(0);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [rejectionInput, setRejectionInput] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [viewedReport, setViewedReport] = useState<Report | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({
        status: statusFilter,
        page: page.toString(),
        limit: "20",
      });
      if (typeFilter) query.set("type", typeFilter);

      const res = await fetch(`/api/admin/hazards/reports?${query}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) { router.replace("/dashboard"); return; }
        throw new Error("Failed to load reports");
      }
      const data = await res.json();
      setReports(data.reports || []);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalReports(data.pagination.total || 0);
    } catch {
      setError("Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, page, router]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  async function moderate(id: string, status: string) {
    setModeratingId(id);
    try {
      const body: any = { status };
      if (status === "REJECTED" && rejectionInput.trim()) body.rejectionReason = rejectionInput.trim();
      const res = await fetch(`/api/admin/hazards/reports/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to moderate");
      toast.success(status === "APPROVED" ? "Report approved" : "Report rejected");
      setRejectingId(null);
      setRejectionInput("");
      setViewedReport(null);
      fetchReports();
    } catch {
      toast.error("Failed to moderate report.");
    } finally {
      setModeratingId(null);
    }
  }

  return (
    <AppShell active="dashboard" title="Community Hazard Reports" subpage onBack={() => router.push("/admin/hazards")}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin/hazards" className="text-slate-400 hover:text-white font-body text-sm">Back to Hazards</Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white">Community Hazard Reports</h1>
        <p className="font-body text-slate-400 mt-1">Review and moderate user-submitted hazard reports.</p>
      </div>

      <div className="mb-6 flex flex-col md:flex-row gap-3">
        <div className="flex gap-2">
          {["PENDING", "APPROVED", "REJECTED", ""].map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-body transition-all ${statusFilter === s ? "bg-amber-400/10 border-amber-400/30 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-500"}`}>
              {s || "ALL"}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-xs focus:outline-none focus:border-amber-400/50">
          <option value="">All types</option>
          {Object.entries(HAZARD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-amber-400" /></div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-400/10 border border-red-400/20 text-red-300 font-body text-sm">{error}</div>
      ) : (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <div className="text-center py-16">
              <AlertTriangle size={36} className="text-slate-700 mx-auto mb-3" />
              <h3 className="font-display font-semibold text-white mb-1">No reports found</h3>
              <p className="font-body text-sm text-slate-400">No community hazard reports matching the filters.</p>
            </div>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-700/50 bg-slate-800/60 px-4 py-3 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
                  r.status === "PENDING" ? "bg-amber-400/10 border-amber-400/20" :
                  r.status === "APPROVED" ? "bg-emerald-400/10 border-emerald-400/20" :
                  "bg-red-400/10 border-red-400/20"
                }`}>
                  <AlertTriangle size={15} className={
                    r.status === "PENDING" ? "text-amber-400" :
                    r.status === "APPROVED" ? "text-emerald-400" : "text-red-400"
                  } />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body font-medium text-white text-sm">{r.title}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[r.severity] || ""}`}>{r.severity}</span>
                    <span className="text-[10px] text-slate-500 font-body bg-slate-700/40 px-1.5 py-0.5 rounded">{HAZARD_TYPE_LABELS[r.hazardType] || r.hazardType}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      r.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                      r.status === "REJECTED" ? "bg-red-500/10 text-red-400" :
                      "bg-amber-500/10 text-amber-400"
                    }`}>{r.status}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 font-body">
                    <span className="flex items-center gap-1"><UserIcon size={10} />{r.user.name}</span>
                    <span className="flex items-center gap-1"><MapPin size={10} />{r.lat.toFixed(3)}, {r.lng.toFixed(3)}</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                  {r.description && <p className="text-xs text-slate-400 mt-1 font-body line-clamp-2">{r.description}</p>}
                  {r.rejectionReason && <p className="text-xs text-rose-400 mt-1 font-body">Reason: {r.rejectionReason}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setViewedReport(r)} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-all" title="View details"><Eye size={14} /></button>
                  {r.status !== "APPROVED" && (
                    <button onClick={() => moderate(r.id, "APPROVED")} disabled={moderatingId === r.id}
                      className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-all" title="Approve">
                      {moderatingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                  )}
                  {r.status !== "REJECTED" && (
                    <button onClick={() => { setRejectingId(r.id); setRejectionInput(""); }} className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-all" title="Reject">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 font-body text-xs text-slate-500">
              <p>Showing {reports.length} of {totalReports} reports</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="bg-slate-900 border-slate-800"><PrevIcon size={14} className="mr-1" /> Prev</Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="bg-slate-900 border-slate-800">Next <NextIcon size={14} className="ml-1" /></Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={viewedReport !== null} onOpenChange={() => setViewedReport(null)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          {viewedReport && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                  <AlertTriangle size={16} className="text-rose-400" />
                  {viewedReport.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Reported by {viewedReport.user.name} · {new Date(viewedReport.createdAt).toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${SEVERITY_COLORS[viewedReport.severity]}`}>{viewedReport.severity}</span>
                  <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">{HAZARD_TYPE_LABELS[viewedReport.hazardType]}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    viewedReport.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                    viewedReport.status === "REJECTED" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"
                  }`}>{viewedReport.status}</span>
                </div>
                {viewedReport.description && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Description</p>
                    <p className="text-slate-300 bg-slate-900/40 p-2.5 rounded border border-slate-800">{viewedReport.description}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500 mb-1">Location</p>
                  <p className="text-slate-300">{viewedReport.lat.toFixed(5)}, {viewedReport.lng.toFixed(5)}</p>
                </div>
                {viewedReport.moderator && (
                  <div className="text-xs text-slate-500">
                    Moderated by {viewedReport.moderator.name} {viewedReport.moderatedAt ? `· ${new Date(viewedReport.moderatedAt).toLocaleString()}` : ""}
                  </div>
                )}
                {viewedReport.rejectionReason && (
                  <div>
                    <p className="text-xs text-rose-400 mb-1">Rejection reason</p>
                    <p className="text-rose-300 bg-rose-900/20 p-2.5 rounded border border-rose-800/40">{viewedReport.rejectionReason}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejectingId !== null} onOpenChange={() => setRejectingId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Reject Report</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">Provide a reason for rejecting this report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea value={rejectionInput} onChange={(e) => setRejectionInput(e.target.value)} placeholder="Reason for rejection…"
              rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white text-sm font-body focus:outline-none focus:border-amber-400/50 resize-none" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectingId(null)} className="border-slate-850 bg-slate-900 text-slate-400">Cancel</Button>
              <Button onClick={() => rejectingId && moderate(rejectingId, "REJECTED")} disabled={moderatingId !== null}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold">
                {moderatingId === rejectingId ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Reject Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
