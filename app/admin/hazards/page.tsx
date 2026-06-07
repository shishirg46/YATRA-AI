/**
 * FILE: page.tsx
 * LOCATION: /app/admin/hazards/page.tsx
 * PURPOSE: Hazard & disaster intelligence — list, create manual logs, verify reports, severity computation
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { 
  ChevronLeft, Search, Filter, AlertTriangle, Trash2, Edit, Check, X,
  Plus, Calendar, Sliders, Upload, Loader2, RefreshCw, Eye, CheckCircle2,
  ChevronLeft as PrevIcon, ChevronRight as NextIcon
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

interface LocationOption {
  id: string;
  name: string;
  district: string;
  province: string;
}

interface HazardEntry {
  id: string;
  locationId: string;
  floodIndex: number | null;
  landslideIndex: number | null;
  heatIndex: number | null;
  airQuality: number | null;
  source: string | null;
  recordedAt: string;
  createdAt: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    district: {
      name: string;
      province: { name: string };
    };
  };
}

export default function AdminHazardsPage() {
  const router = useRouter();

  // Data states
  const [hazards, setHazards] = useState<HazardEntry[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Page
  const [districtFilter, setDistrictFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalHazards, setTotalHazards] = useState(0);

  // Form Modal States
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [floodIndex, setFloodIndex] = useState(0);
  const [landslideIndex, setLandslideIndex] = useState(0);
  const [heatIndex, setHeatIndex] = useState(0);
  const [airQuality, setAirQuality] = useState(0);
  const [recordedAt, setRecordedAt] = useState("");
  const [image, setImage] = useState("");
  const [notes, setNotes] = useState("");
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // View Detail State
  const [viewedHazard, setViewedHazard] = useState<HazardEntry | null>(null);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchHazards();
  }, [page, severityFilter]);

  // Debounced search trigger for district
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchHazards();
    }, 400);
    return () => clearTimeout(timer);
  }, [districtFilter]);

  useEffect(() => {
    fetchLocationsLookup();
  }, []);

  async function fetchHazards() {
    try {
      setLoading(true);
      setError(null);

      const query = new URLSearchParams({
        district: districtFilter,
        severity: severityFilter,
        page: page.toString(),
        limit: "10",
      });

      const res = await fetch(`/api/admin/hazards?${query.toString()}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to load hazards: ${res.status}`);
      }
      const data = await res.json();
      setHazards(data.hazards || []);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalHazards(data.pagination.total || 0);
    } catch (err) {
      console.error("[hazards page]", err);
      setError("Failed to fetch hazard timeline databases.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLocationsLookup() {
    try {
      const res = await fetch("/api/admin/locations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLocations(data);
      }
    } catch (err) {
      console.error("[locations lookup]", err);
    }
  }

  // Calculate severity inline matching the backend compute rules
  function calculateSeverity(f: number, l: number, h: number, a: number) {
    const penalty = (f * 25) + (l * 25) + (h * 5) + (a * 5);
    const score = 100 - penalty;
    if (score >= 80) return { label: "SAFE", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
    if (score >= 60) return { label: "CAUTION", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
    if (score >= 40) return { label: "HIGH RISK", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" };
    return { label: "EXTREME", color: "text-red-400 bg-red-500/10 border-red-500/20" };
  }

  // Image Upload helper
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingImage(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to upload");
      }

      const data = await res.json();
      setImage(data.url);
      toast.success("Hazard scene photo uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed.");
    } finally {
      setUploadingImage(false);
    }
  }

  // Open creation modal
  function openAddForm() {
    setEditingId(null);
    setSelectedLocationId(locations[0]?.id || "");
    setFloodIndex(0);
    setLandslideIndex(0);
    setHeatIndex(0);
    setAirQuality(0);
    setRecordedAt(new Date().toISOString().substring(0, 16));
    setImage("");
    setNotes("");
    setVerified(true); // admin posts are verified
    setFormOpen(true);
  }

  // Open edit modal
  function openEditForm(entry: HazardEntry) {
    setEditingId(entry.id);
    setSelectedLocationId(entry.locationId);
    setFloodIndex(entry.floodIndex || 0);
    setLandslideIndex(entry.landslideIndex || 0);
    setHeatIndex(entry.heatIndex || 0);
    setAirQuality(entry.airQuality || 0);
    setRecordedAt(new Date(entry.recordedAt).toISOString().substring(0, 16));
    
    // Decode source for notes and images
    const parts = (entry.source || "").split("|");
    setImage(parts[2] || "");
    setNotes(parts[3] || "");
    setVerified(parts[1] === "VERIFIED");

    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLocationId || !recordedAt) {
      toast.error("Please fill in location and time.");
      return;
    }

    try {
      setSubmitting(true);
      const url = editingId ? `/api/admin/hazards/${editingId}` : "/api/admin/hazards";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: selectedLocationId,
          floodIndex,
          landslideIndex,
          heatIndex,
          airQuality,
          recordedAt: new Date(recordedAt).toISOString(),
          image,
          notes,
          verified,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to save hazard entry");
      }

      toast.success(editingId ? "Hazard log updated" : "Hazard log created");
      setFormOpen(false);
      fetchHazards();
    } catch (err) {
      toast.error("Failed to save hazard log.");
    } finally {
      setSubmitting(false);
    }
  }

  // Verify Manual Report
  async function verifyHazard(hazardId: string) {
    try {
      setVerifyingId(hazardId);
      const res = await fetch(`/api/admin/hazards/${hazardId}/verify`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Verification failed");
      toast.success("Hazard report verified");
      fetchHazards();
    } catch (err) {
      toast.error("Could not verify report.");
    } finally {
      setVerifyingId(null);
    }
  }

  // Delete entry
  async function handleDelete(hazardId: string) {
    try {
      const res = await fetch(`/api/admin/hazards/${hazardId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Hazard entry removed");
      setDeletingId(null);
      fetchHazards();
    } catch (err) {
      toast.error("Could not delete entry.");
    }
  }

  // Decoders for list display
  function getHazardMetadata(sourceStr: string | null) {
    const parts = (sourceStr || "").split("|");
    return {
      type: parts[0] || "SYSTEM",
      verified: parts[1] === "VERIFIED",
      image: parts[2] || null,
      notes: parts[3] || "",
    };
  }

  return (
    <AppShell active="dashboard" title="Hazard & Disaster Management" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ChevronLeft size={18} className="text-slate-400" />
            <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
              Back to Admin
            </Link>
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Hazard & Disaster Logs</h1>
          <p className="font-body text-slate-400 mt-1">
            Register real-time environmental hazards, audit disaster indices, and verify manual reports
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/admin/hazards/reports" className="px-4 py-2 rounded-lg border border-slate-700/50 text-slate-300 hover:text-white hover:border-slate-500 transition-all font-body text-sm flex items-center gap-1.5">
            <AlertTriangle size={14} /> Community Reports
          </Link>
          <Button
            onClick={openAddForm}
            className="bg-amber-400 text-slate-950 hover:bg-amber-500 font-semibold font-body flex items-center gap-1.5"
          >
            <Plus size={16} /> Log Hazard Entry
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Filter by district name…"
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700/50 text-white font-body text-sm"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Severities</option>
            <option value="EXTREME">EXTREME</option>
            <option value="HIGH_RISK">HIGH RISK</option>
            <option value="CAUTION">CAUTION</option>
            <option value="SAFE">SAFE</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Data table and timeline */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={36} />
          <p className="font-body text-slate-400">Loading hazard intelligence timeline…</p>
        </div>
      ) : error ? (
        <div className="stat-card p-4 bg-red-400/10 border-red-500/30 text-red-300">{error}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Hazards List Table */}
          <div className="lg:col-span-2 stat-card p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-widest">
                    <th className="py-3 px-4 font-body">Location</th>
                    <th className="py-3 px-4 font-body text-center">Severity</th>
                    <th className="py-3 px-4 font-body">Indices</th>
                    <th className="py-3 px-4 font-body">Source</th>
                    <th className="py-3 px-4 font-body text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {hazards.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-550 font-body">
                        No hazard records found.
                      </td>
                    </tr>
                  ) : (
                    hazards.map((item) => {
                      const severity = calculateSeverity(
                        item.floodIndex || 0,
                        item.landslideIndex || 0,
                        item.heatIndex || 0,
                        item.airQuality || 0
                      );
                      const meta = getHazardMetadata(item.source);

                      return (
                        <tr key={item.id} className="hover:bg-slate-800/10 transition-colors font-body text-sm">
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-semibold text-white">{item.location.name}</p>
                              <p className="text-xs text-slate-500">
                                {item.location.district.name}, {item.location.district.province.name}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${severity.color}`}>
                              {severity.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-400 space-y-0.5">
                            <p>Flood: {(item.floodIndex || 0).toFixed(2)}</p>
                            <p>Landslide: {(item.landslideIndex || 0).toFixed(2)}</p>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-0.5 text-xs">
                              <span className="text-slate-300 font-semibold">{meta.type}</span>
                              {meta.type === "MANUAL" && (
                                <span className={`text-[10px] font-bold ${meta.verified ? "text-emerald-400" : "text-amber-500"}`}>
                                  {meta.verified ? "Verified" : "Pending Verify"}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {meta.type === "MANUAL" && !meta.verified && (
                                <button
                                  onClick={() => verifyHazard(item.id)}
                                  disabled={verifyingId !== null}
                                  className="p-1 rounded bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2"
                                  title="Verify Manual Report"
                                >
                                  {verifyingId === item.id ? <Loader2 size={10} className="animate-spin" /> : "Verify"}
                                </button>
                              )}
                              <button
                                onClick={() => setViewedHazard(item)}
                                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                                title="View Details"
                              >
                                <Eye size={15} />
                              </button>
                              <button
                                onClick={() => openEditForm(item)}
                                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                                title="Edit"
                              >
                                <Edit size={15} />
                              </button>
                              <button
                                onClick={() => setDeletingId(item.id)}
                                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-red-400"
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-800 mt-4 pt-4 font-body text-xs text-slate-500">
                <p>Showing {(page - 1) * 10 + 1} - {Math.min(page * 10, totalHazards)} of {totalHazards} entries</p>
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

          {/* Historical Timeline Visual Panel */}
          <div className="stat-card p-4 flex flex-col">
            <h3 className="font-display text-base font-bold text-white mb-3">Recorded Activity Timeline</h3>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 max-h-[500px]">
              {hazards.slice(0, 5).map((h) => {
                const meta = getHazardMetadata(h.source);
                const severity = calculateSeverity(
                  h.floodIndex || 0,
                  h.landslideIndex || 0,
                  h.heatIndex || 0,
                  h.airQuality || 0
                );
                return (
                  <div key={h.id} className="relative pl-4 border-l border-slate-800 text-xs font-body">
                    <div className="absolute left-[-4.5px] top-1.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-950" />
                    <p className="text-slate-500">{new Date(h.recordedAt).toLocaleString()}</p>
                    <p className="font-semibold text-white text-sm mt-0.5">{h.location.name}</p>
                    <p className="text-slate-400 mt-1">{meta.notes || "No description notes logged."}</p>
                    <div className="flex gap-1.5 mt-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${severity.color}`}>{severity.label}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-500 text-[9px] uppercase">{meta.type}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CREATE & EDIT HAZARD FORM MODAL */}
      <Dialog open={formOpen} onOpenChange={() => setFormOpen(false)}>
        <DialogContent className="max-w-xl bg-slate-950 border border-slate-800 text-white rounded-xl font-body max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Sliders className="text-amber-400" /> {editingId ? "Edit Hazard Assessment Details" : "Log Manual Disaster Hazard"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Input indices manually. Environmental changes immediately trigger routing pipeline updates.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Select Location Context *</label>
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
                required
              >
                <option value="" disabled>-- Choose Location --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.district}, {loc.province})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Record Timestamp *</label>
              <Input
                type="datetime-local"
                value={recordedAt}
                onChange={(e) => setRecordedAt(e.target.value)}
                className="bg-slate-900 border-slate-700/60 text-white"
                required
              />
            </div>

            {/* Sliders for Indices */}
            <div className="grid grid-cols-2 gap-4 bg-slate-900/40 p-4 rounded-lg border border-slate-850">
              <div>
                <div className="flex justify-between items-center mb-1 text-xs">
                  <span className="font-semibold text-slate-300">Flood Index</span>
                  <span className="font-bold text-white">{floodIndex.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={floodIndex}
                  onChange={(e) => setFloodIndex(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1 text-xs">
                  <span className="font-semibold text-slate-300">Landslide Index</span>
                  <span className="font-bold text-white">{landslideIndex.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={landslideIndex}
                  onChange={(e) => setLandslideIndex(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1 text-xs">
                  <span className="font-semibold text-slate-300">Heat Index</span>
                  <span className="font-bold text-white">{heatIndex.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={heatIndex}
                  onChange={(e) => setHeatIndex(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1 text-xs">
                  <span className="font-semibold text-slate-300">Air Quality</span>
                  <span className="font-bold text-white">{airQuality.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={airQuality}
                  onChange={(e) => setAirQuality(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>

              <div className="col-span-2 pt-2 border-t border-slate-800 mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">Live Severity Prediction:</span>
                {(() => {
                  const severity = calculateSeverity(floodIndex, landslideIndex, heatIndex, airQuality);
                  return (
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded border uppercase ${severity.color}`}>
                      {severity.label}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* Cloudinary Image upload */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Hazard Photo Proof (Cloudinary)</label>
              <div className="flex gap-2">
                <Input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="Scene image secure URL…"
                  className="bg-slate-900 border-slate-700/60 text-white flex-1 text-xs"
                />
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  variant="outline"
                  className="border-slate-800 bg-slate-900 hover:text-white"
                >
                  {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  <span className="ml-1.5 text-xs">Upload</span>
                </Button>
              </div>
              {image && (
                <div className="mt-2 relative inline-block rounded overflow-hidden border border-slate-800">
                  <Image src={image} alt="Preview" width={200} height={80} className="h-20 object-cover rounded" unoptimized />
                  <button
                    type="button"
                    onClick={() => setImage("")}
                    className="absolute -top-1 -right-1 p-0.5 bg-red-650 hover:bg-red-700 rounded-full text-white text-[9px]"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Description Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Log notes about landslips, river overflows, road blockages..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
              />
            </div>

            <div className="flex gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-850">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                id="haz-ver"
                className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
              />
              <label htmlFor="haz-ver" className="text-xs font-semibold text-slate-300">Verify immediately (publish to map overlay)</label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-amber-400 text-slate-950 font-semibold hover:bg-amber-500"
              >
                {submitting ? "Publishing Assessment…" : editingId ? "Save Changes" : "Log Hazard Data"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DETAIL MODAL */}
      <Dialog open={viewedHazard !== null} onOpenChange={() => setViewedHazard(null)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          {viewedHazard && (
            <>
              <DialogHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <DialogTitle className="text-lg font-bold text-white">{viewedHazard.location.name}</DialogTitle>
                    <DialogDescription className="text-xs text-slate-400 mt-1">
                      {viewedHazard.location.district.name}, {viewedHazard.location.district.province.name}
                    </DialogDescription>
                  </div>
                  {(() => {
                    const severity = calculateSeverity(
                      viewedHazard.floodIndex || 0,
                      viewedHazard.landslideIndex || 0,
                      viewedHazard.heatIndex || 0,
                      viewedHazard.airQuality || 0
                    );
                    return (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${severity.color}`}>
                        {severity.label}
                      </span>
                    );
                  })()}
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-2 text-xs">
                {/* Proof Image */}
                {(() => {
                  const meta = getHazardMetadata(viewedHazard.source);
                  return meta.image ? (
                    <div className="rounded overflow-hidden border border-slate-800 bg-slate-900/60 max-h-48 flex items-center justify-center">
                      <Image src={meta.image} alt="Hazard scene proof" width={400} height={300} className="max-h-48 object-contain" unoptimized />
                    </div>
                  ) : null;
                })()}

                {/* Score breakdown */}
                <div className="grid grid-cols-2 gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-850">
                  <div>
                    <p className="text-slate-500">Flood Index</p>
                    <p className="text-sm font-semibold text-white">{viewedHazard.floodIndex?.toFixed(2) || "0.00"}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Landslide Index</p>
                    <p className="text-sm font-semibold text-white">{viewedHazard.landslideIndex?.toFixed(2) || "0.00"}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Heat Index</p>
                    <p className="text-sm font-semibold text-white">{viewedHazard.heatIndex?.toFixed(2) || "0.00"}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Air Quality</p>
                    <p className="text-sm font-semibold text-white">{viewedHazard.airQuality?.toFixed(2) || "0.00"}</p>
                  </div>
                </div>

                {/* Extra info */}
                <div className="space-y-2">
                  <div>
                    <p className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Source Pipeline</p>
                    <p className="text-white text-xs">{getHazardMetadata(viewedHazard.source).type}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Reported Time</p>
                    <p className="text-white text-xs">{new Date(viewedHazard.recordedAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Verification Status</p>
                    <p className="text-white text-xs">
                      {getHazardMetadata(viewedHazard.source).verified ? "Verified Log (active)" : "Pending Admin Review"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Description Notes</p>
                    <p className="text-slate-300 text-xs italic bg-slate-900/20 p-2.5 rounded border border-slate-900">
                      {getHazardMetadata(viewedHazard.source).notes || "No notes logged for this incident entry."}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION */}
      <Dialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Remove Hazard Log?</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Are you sure you want to permanently delete this hazard entry? This will immediately recalculate the safety score for the linked location.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deletingId && handleDelete(deletingId)}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              Delete Log
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
