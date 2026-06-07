/**
 * FILE: page.tsx
 * LOCATION: /app/admin/destinations/page.tsx
 * PURPOSE: Destinations administration — CRUD, Cloudinary upload, verification, merging duplicates
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { 
  ChevronLeft, Search, Filter, CheckCircle2, AlertCircle, 
  MapPin, Loader2, Plus, Edit, Trash2, Merge, Upload, X, Check,
  ChevronLeft as PrevIcon, ChevronRight as NextIcon, Activity
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

interface Destination {
  id: string;
  name: string;
  district: string;
  province: string;
  municipality: string | null;
  category: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  description: string | null;
  image: string | null;
  tags: string[];
  verified: boolean;
  routeAccessible: boolean;
  dataQualityScore: number | null;
  coordinateAccuracy: number | null;
}

const CATEGORIES = [
  "VIEWPOINT",
  "TREKKING_VILLAGE",
  "LAKE",
  "HILL",
  "MOUNTAIN",
  "TOURIST_ATTRACTION",
  "MUNICIPALITY",
  "CHOWK",
  "TEMPLE",
  "RIVERSIDE",
  "FOREST",
  "WATERFALL",
  "CAMP",
  "MOUNTAIN_SETTLEMENT"
];

export default function AdminDestinationsPage() {
  const router = useRouter();
  
  // Data list states
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter States
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDestinations, setTotalDestinations] = useState(0);

  // Form States (for Create and Edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("TOURIST_ATTRACTION");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [altitude, setAltitude] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [tags, setTags] = useState("");
  const [routeAccessible, setRouteAccessible] = useState(true);
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Merge State
  const [mergeOpen, setMergeOpen] = useState(false);
  const [primarySearch, setPrimarySearch] = useState("");
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [primaryOptions, setPrimaryOptions] = useState<Destination[]>([]);
  const [duplicateOptions, setDuplicateOptions] = useState<Destination[]>([]);
  const [selectedPrimary, setSelectedPrimary] = useState<Destination | null>(null);
  const [selectedDuplicate, setSelectedDuplicate] = useState<Destination | null>(null);
  const [merging, setMerging] = useState(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDestinations();
  }, [page, categoryFilter, verifiedFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchDestinations();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  async function fetchDestinations() {
    try {
      setLoading(true);
      setError(null);
      
      const query = new URLSearchParams({
        search,
        category: categoryFilter,
        verified: verifiedFilter,
        page: page.toString(),
        limit: "10"
      });

      const res = await fetch(`/api/admin/destinations?${query.toString()}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to load: ${res.status}`);
      }
      const data = await res.json();
      setDestinations(data.destinations || []);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalDestinations(data.pagination.total || 0);
    } catch (err) {
      console.error("[destinations page]", err);
      setError("Failed to load destinations database.");
    } finally {
      setLoading(false);
    }
  }

  // Handle image upload to Cloudinary via admin endpoint
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
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to upload");
      }

      const data = await res.json();
      setImage(data.url);
      toast.success("Image uploaded successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image.");
    } finally {
      setUploadingImage(false);
    }
  }

  // Open Form for Adding
  function openAddForm() {
    setEditingId(null);
    setName("");
    setCategory("TOURIST_ATTRACTION");
    setProvince("");
    setDistrict("");
    setMunicipality("");
    setLatitude("");
    setLongitude("");
    setAltitude("");
    setDescription("");
    setImage("");
    setTags("");
    setRouteAccessible(true);
    setVerified(true); // default to verified for admins
    setFormOpen(true);
  }

  // Open Form for Editing
  function openEditForm(dest: Destination) {
    setEditingId(dest.id);
    setName(dest.name);
    setCategory(dest.category);
    setProvince(dest.province);
    setDistrict(dest.district);
    setMunicipality(dest.municipality || "");
    setLatitude(dest.latitude.toString());
    setLongitude(dest.longitude.toString());
    setAltitude(dest.altitude?.toString() || "");
    setDescription(dest.description || "");
    setImage(dest.image || "");
    setTags(dest.tags.join(", "));
    setRouteAccessible(dest.routeAccessible);
    setVerified(dest.verified);
    setFormOpen(true);
  }

  // Handle Form Submit (Create or Update)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !province || !district || !latitude || !longitude) {
      toast.error("Please fill in all required fields.");
      return;
    }

    try {
      setSubmitting(true);
      const url = editingId ? `/api/admin/destinations/${editingId}` : "/api/admin/destinations";
      const method = editingId ? "PATCH" : "POST";

      const tagsArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const payload = {
        name,
        category,
        province,
        district,
        municipality: municipality || null,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        altitude: altitude ? parseFloat(altitude) : null,
        description: description || null,
        image: image || null,
        tags: tagsArray,
        routeAccessible,
        verified,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to save destination");
      }

      toast.success(editingId ? "Destination updated" : "Destination created");
      setFormOpen(false);
      fetchDestinations();
    } catch (err: any) {
      toast.error(err.message || "Failed to save destination.");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Verification Toggle from Table Action
  async function verifyDestination(destId: string) {
    try {
      setVerifyingId(destId);
      const res = await fetch(`/api/admin/destinations/${destId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified: true }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to verify");
      
      toast.success("Destination verified");
      fetchDestinations();
    } catch (err) {
      toast.error("Could not verify destination.");
    } finally {
      setVerifyingId(null);
    }
  }

  // Handle Delete
  async function handleDelete(destId: string) {
    try {
      const res = await fetch(`/api/admin/destinations/${destId}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to delete");
      
      toast.success("Destination deleted permanently");
      setDeletingId(null);
      fetchDestinations();
    } catch (err) {
      toast.error("Could not delete destination.");
    }
  }

  // Handle Duplicates search inside Merge Modal
  useEffect(() => {
    if (primarySearch.length > 1) {
      fetch(`/api/admin/destinations?search=${encodeURIComponent(primarySearch)}&limit=5`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setPrimaryOptions(data.destinations || []));
    } else {
      setPrimaryOptions([]);
    }
  }, [primarySearch]);

  useEffect(() => {
    if (duplicateSearch.length > 1) {
      fetch(`/api/admin/destinations?search=${encodeURIComponent(duplicateSearch)}&limit=5`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setDuplicateOptions(data.destinations || []));
    } else {
      setDuplicateOptions([]);
    }
  }, [duplicateSearch]);

  async function handleMerge() {
    if (!selectedPrimary || !selectedDuplicate) return;
    try {
      setMerging(true);
      const res = await fetch("/api/admin/destinations/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryId: selectedPrimary.id,
          duplicateId: selectedDuplicate.id,
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Merge failed");
      }

      toast.success("Destinations merged successfully");
      setMergeOpen(false);
      setSelectedPrimary(null);
      setSelectedDuplicate(null);
      setPrimarySearch("");
      setDuplicateSearch("");
      fetchDestinations();
    } catch (err: any) {
      toast.error(err.message || "Failed to merge destinations.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <AppShell active="dashboard" title="Destinations Management" subpage onBack={() => router.push("/admin")}>
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ChevronLeft size={18} className="text-slate-400" />
            <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
              Back to Admin
            </Link>
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Destinations Database</h1>
          <p className="font-body text-slate-400 mt-1">Add, update, verify, and resolve duplicate destinations across Nepal</p>
        </div>
        
        <div className="flex gap-2 font-body">
          <Button
            onClick={() => setMergeOpen(true)}
            variant="outline"
            className="border-slate-800 bg-slate-900/60 text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            <Merge size={16} /> Merge Duplicates
          </Button>
          <Button
            onClick={openAddForm}
            className="bg-amber-400 text-slate-950 hover:bg-amber-500 font-semibold flex items-center gap-1.5"
          >
            <Plus size={16} /> Add Destination
          </Button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search by name, district, or province…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700/50 text-white"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select
            value={verifiedFilter}
            onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Statuses</option>
            <option value="true">Verified</option>
            <option value="false">Pending Verification</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={36} />
          <p className="font-body text-slate-400">Fetching destinations database…</p>
        </div>
      ) : error ? (
        <div className="stat-card p-4 bg-red-400/10 border-red-500/30 text-red-300">{error}</div>
      ) : (
        <div className="stat-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-widest">
                  <th className="py-3 px-4 font-body">Name</th>
                  <th className="py-3 px-4 font-body">Location</th>
                  <th className="py-3 px-4 font-body">Category</th>
                  <th className="py-3 px-4 font-body text-center">Quality Score</th>
                  <th className="py-3 px-4 font-body">Verification</th>
                  <th className="py-3 px-4 font-body text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {destinations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-550 font-body">
                      No destinations matching current criteria.
                    </td>
                  </tr>
                ) : (
                  destinations.map((dest) => (
                    <tr key={dest.id} className="hover:bg-slate-800/10 transition-colors font-body text-sm">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-semibold text-white">{dest.name}</p>
                          <p className="text-xs text-slate-500">
                            {dest.latitude.toFixed(4)}, {dest.longitude.toFixed(4)}
                          </p>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {dest.district}, {dest.province}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        <span className="text-xs px-2 py-0.5 bg-slate-900 border border-slate-800 rounded">
                          {dest.category.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`font-semibold px-2 py-0.5 rounded text-xs ${
                            dest.dataQualityScore && dest.dataQualityScore >= 90
                              ? "text-emerald-400 bg-emerald-500/10"
                              : dest.dataQualityScore && dest.dataQualityScore >= 80
                                ? "text-amber-400 bg-amber-500/10"
                                : "text-slate-400 bg-slate-800"
                          }`}
                        >
                          {dest.dataQualityScore ? `${Math.round(dest.dataQualityScore)}/100` : "N/A"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {dest.verified ? (
                            <>
                              <CheckCircle2 size={15} className="text-emerald-400" />
                              <span className="text-xs text-emerald-400 font-semibold">Verified</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle size={15} className="text-amber-500" />
                              <span className="text-xs text-amber-500 font-semibold">Pending</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!dest.verified && (
                            <button
                              onClick={() => verifyDestination(dest.id)}
                              disabled={verifyingId !== null}
                              className="p-1 rounded bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 transition-all text-xs font-semibold px-2 py-1"
                            >
                              {verifyingId === dest.id ? <Loader2 size={12} className="animate-spin" /> : "Verify"}
                            </button>
                          )}
                          <button
                            onClick={() => openEditForm(dest)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Edit Destination"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            onClick={() => setDeletingId(dest.id)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 mt-4 pt-4 font-body text-xs text-slate-500">
              <p>Showing {(page - 1) * 10 + 1} - {Math.min(page * 10, totalDestinations)} of {totalDestinations} items</p>
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

      {/* CREATE & EDIT FORM MODAL */}
      <Dialog open={formOpen} onOpenChange={() => setFormOpen(false)}>
        <DialogContent className="max-w-2xl bg-slate-950 border border-slate-800 text-white rounded-xl font-body max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">
              {editingId ? "Edit Destination Details" : "Add New Tourist Destination"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Provide geographic details, coordinate accuracy, and images to seed the safety pipeline.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Destination Name *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Poon Hill"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Category *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Province *</label>
                <Input
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  placeholder="e.g. Gandaki"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">District *</label>
                <Input
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="e.g. Myagdi"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Municipality (Optional)</label>
                <Input
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  placeholder="e.g. Annapurna"
                  className="bg-slate-900 border-slate-700/60 text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Altitude (Meters)</label>
                <Input
                  value={altitude}
                  onChange={(e) => setAltitude(e.target.value)}
                  type="number"
                  placeholder="e.g. 3210"
                  className="bg-slate-900 border-slate-700/60 text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Latitude *</label>
                <Input
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  type="number"
                  step="0.000001"
                  placeholder="e.g. 28.4005"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Longitude *</label>
                <Input
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  type="number"
                  step="0.000001"
                  placeholder="e.g. 83.7011"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details about travel routes, season guide, highlights…"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
              />
            </div>

            {/* Cloudinary Image Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Destination Photo (Cloudinary Upload)</label>
              <div className="flex gap-2">
                <Input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="Cloudinary image URL or external link…"
                  className="bg-slate-900 border-slate-700/60 text-white flex-1"
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
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Tags (Comma Separated)</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="trekking, views, high-altitude"
                className="bg-slate-900 border-slate-700/60 text-white"
              />
            </div>

            <div className="flex gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-850">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={routeAccessible}
                  onChange={(e) => setRouteAccessible(e.target.checked)}
                  id="acc"
                  className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                />
                <label htmlFor="acc" className="text-xs font-semibold text-slate-300">Route Accessible</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  id="ver"
                  className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                />
                <label htmlFor="ver" className="text-xs font-semibold text-slate-300">Verified by Admin</label>
              </div>
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
                {submitting ? "Saving Destination…" : editingId ? "Save Changes" : "Create Destination"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MERGE DUPLICATES MODAL */}
      <Dialog open={mergeOpen} onOpenChange={() => setMergeOpen(false)}>
        <DialogContent className="max-w-3xl bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Merge className="text-amber-400" /> Merge Duplicate Destinations
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Combine details, tags, and photos of duplicate records. The duplicate item will be permanently deleted after references are safely merged.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 mt-2">
            {/* Primary Column */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">1. Select Primary (To Keep)</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  value={primarySearch}
                  onChange={(e) => setPrimarySearch(e.target.value)}
                  placeholder="Search primary destination…"
                  className="pl-8 bg-slate-900 border-slate-700/60 text-xs"
                />
              </div>

              {primaryOptions.length > 0 && (
                <div className="border border-slate-800 bg-slate-900 rounded max-h-32 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                  {primaryOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setSelectedPrimary(opt); setPrimaryOptions([]); }}
                      className="w-full text-left p-2 hover:bg-slate-800 transition-colors block"
                    >
                      <p className="font-semibold text-white">{opt.name}</p>
                      <p className="text-slate-500">{opt.district}, {opt.province}</p>
                    </button>
                  ))}
                </div>
              )}

              {selectedPrimary ? (
                <div className="p-3 bg-slate-900 border border-emerald-500/20 rounded text-xs space-y-1">
                  <p className="font-bold text-emerald-400 flex items-center gap-1">
                    <Check size={14} /> Selected Primary
                  </p>
                  <p className="font-semibold text-white">{selectedPrimary.name}</p>
                  <p className="text-slate-400">{selectedPrimary.district}, {selectedPrimary.province}</p>
                  <p className="text-slate-500">Category: {selectedPrimary.category}</p>
                  <p className="text-slate-500">Altitude: {selectedPrimary.altitude || "N/A"}m</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No primary destination selected.</p>
              )}
            </div>

            {/* Duplicate Column */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">2. Select Duplicate (To Merge & Delete)</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  value={duplicateSearch}
                  onChange={(e) => setDuplicateSearch(e.target.value)}
                  placeholder="Search duplicate destination…"
                  className="pl-8 bg-slate-900 border-slate-700/60 text-xs"
                />
              </div>

              {duplicateOptions.length > 0 && (
                <div className="border border-slate-800 bg-slate-900 rounded max-h-32 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                  {duplicateOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setSelectedDuplicate(opt); setDuplicateOptions([]); }}
                      className="w-full text-left p-2 hover:bg-slate-800 transition-colors block"
                    >
                      <p className="font-semibold text-white">{opt.name}</p>
                      <p className="text-slate-500">{opt.district}, {opt.province}</p>
                    </button>
                  ))}
                </div>
              )}

              {selectedDuplicate ? (
                <div className="p-3 bg-slate-900 border border-red-500/20 rounded text-xs space-y-1">
                  <p className="font-bold text-red-400 flex items-center gap-1">
                    <Check size={14} /> Selected Duplicate
                  </p>
                  <p className="font-semibold text-white">{selectedDuplicate.name}</p>
                  <p className="text-slate-400">{selectedDuplicate.district}, {selectedDuplicate.province}</p>
                  <p className="text-slate-500">Category: {selectedDuplicate.category}</p>
                  <p className="text-slate-500">Altitude: {selectedDuplicate.altitude || "N/A"}m</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No duplicate destination selected.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-6">
            <Button
              variant="outline"
              onClick={() => setMergeOpen(false)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={merging || !selectedPrimary || !selectedDuplicate}
              className="bg-amber-400 text-slate-950 font-semibold hover:bg-amber-500"
            >
              {merging ? "Merging Destinations…" : "Execute Merge"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION */}
      <Dialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Delete Destination Record?</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Are you sure you want to permanently delete this destination? This will wipe the spatial record from the map and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              No, Keep It
            </Button>
            <Button
              onClick={() => deletingId && handleDelete(deletingId)}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              Yes, Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
