/**
 * FILE: page.tsx
 * LOCATION: /app/admin/audit-logs/page.tsx
 * PURPOSE: Audit Log Viewer — list, filter and search administrator actions
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ChevronLeft, Search, Filter, Loader2, Calendar, Shield, Clock,
  ChevronLeft as PrevIcon, ChevronRight as NextIcon
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  user: {
    name: string | null;
    email: string;
  } | null;
}

const ACTION_TYPES = [
  "CREATE_DESTINATION",
  "UPDATE_DESTINATION",
  "DELETE_DESTINATION",
  "MERGE_DESTINATION_DUPLICATE",
  "VERIFY_HAZARD_DATA",
  "CREATE_HAZARD",
  "UPDATE_HAZARD",
  "DELETE_HAZARD",
  "CREATE_ROUTE_NODE",
  "UPDATE_ROUTE_NODE",
  "DELETE_ROUTE_NODE",
  "CREATE_ROUTE_EDGE",
  "UPDATE_ROUTE_EDGE",
  "DELETE_ROUTE_EDGE",
  "UPDATE_USER",
  "DELETE_USER"
];

export default function AdminAuditLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  useEffect(() => {
    fetchLogs();
  }, [page, actionFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchLogs();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  async function fetchLogs() {
    try {
      setLoading(true);
      setError(null);

      const query = new URLSearchParams({
        search,
        action: actionFilter,
        page: page.toString(),
        limit: "15"
      });

      const res = await fetch(`/api/admin/audit-logs?${query.toString()}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error("Failed to load logs");
      }

      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalLogs(data.pagination.total || 0);
    } catch (err) {
      console.error("[audit logs]", err);
      setError("Failed to retrieve system security logs.");
    } finally {
      setLoading(false);
    }
  }

  // Get color for action pills
  function getActionColor(action: string) {
    if (action.includes("DELETE")) {
      return "text-red-400 bg-red-500/10 border-red-500/20";
    }
    if (action.includes("CREATE")) {
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    }
    if (action.includes("MERGE") || action.includes("VERIFY")) {
      return "text-purple-400 bg-purple-500/10 border-purple-500/20";
    }
    return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  }

  return (
    <AppShell active="dashboard" title="System Audit Logs" subpage onBack={() => router.push("/admin")}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
            Back to Admin
          </Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white flex items-center gap-2">
          <Shield className="text-amber-400" /> System Audit Logs
        </h1>
        <p className="font-body text-slate-400 mt-1">
          Trace security-sensitive actions, database modifications, and administrative staff workflows
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search by action, entity ID, or operator name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700/50 text-white font-body text-sm"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Action Types</option>
            {ACTION_TYPES.map((act) => (
              <option key={act} value={act}>{act.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={36} />
          <p className="font-body text-slate-400">Fetching audit log stream…</p>
        </div>
      ) : error ? (
        <div className="stat-card p-4 bg-red-400/10 border-red-500/30 text-red-300">{error}</div>
      ) : (
        <div className="stat-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-widest">
                  <th className="py-3 px-4 font-body">Timestamp</th>
                  <th className="py-3 px-4 font-body">Operator</th>
                  <th className="py-3 px-4 font-body">Action</th>
                  <th className="py-3 px-4 font-body">Target Entity</th>
                  <th className="py-3 px-4 font-body">Entity ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-550 font-body">
                      No security audit events recorded.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/10 transition-colors font-body text-sm">
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-slate-550" />
                          <span>{new Date(log.createdAt).toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {log.user ? (
                          <div>
                            <p className="font-semibold text-white">{log.user.name || "Unnamed staff"}</p>
                            <p className="text-xs text-slate-500">{log.user.email}</p>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">System / Deleted User</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wide ${getActionColor(log.action)}`}>
                          {log.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-semibold">{log.entity}</td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-xs">{log.entityId || "N/A"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 mt-4 pt-4 font-body text-xs text-slate-500">
              <p>Showing {(page - 1) * 15 + 1} - {Math.min(page * 15, totalLogs)} of {totalLogs} events</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="bg-slate-900 border-slate-800"
                >
                  <PrevIcon size={14} className="mr-1" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="bg-slate-900 border-slate-800"
                >
                  Next <NextIcon size={14} className="ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
