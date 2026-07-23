"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Calendar, Mountain, Loader2, Camera, X, Check,
  Plus, ImageIcon, Trash2,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PhotoUpload } from "@/app/dashboard/_components/ui";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type CompletedTrip = {
  id: string; title: string; startDate: string; endDate: string;
  stops: { name: string }[];
  _count: { members: number; stops: number };
};

type WishlistItem = {
  destination: {
    id: string; name: string; district: string; province: string;
    category: string; image: string | null; safetyScore: number | null;
  };
};

type TripPhoto = {
  id: string; imageUrl: string; caption: string | null;
  location: string | null; tripId: string | null; createdAt: string;
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completedTrips, setCompletedTrips] = useState<CompletedTrip[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadLocation, setUploadLocation] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState<{ id: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, tripsRes, photosRes] = await Promise.all([
        fetch("/api/dashboard", { credentials: "include" }),
        fetch("/api/user/trips/completed", { credentials: "include" }),
        fetch("/api/user/photos", { credentials: "include" }),
      ]);
      if (!profileRes.ok) { router.push("/sign-in"); return; }
      const profileData = await profileRes.json();
      setProfile(profileData.user);
      if (tripsRes.ok) {
        const tripsData = await tripsRes.json();
        setCompletedTrips(tripsData.completedTrips ?? []);
        setWishlist(tripsData.wishlist ?? []);
      }
      if (photosRes.ok) {
        const photosData = await photosRes.json();
        setPhotos(photosData.photos ?? []);
      }
    } catch {} finally { setLoading(false); }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image."); return; }
    if (file.size > 10 * 1024 * 1024) { alert("Image must be under 10 MB."); return; }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadSuccess(false);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", selectedFile);
      if (uploadCaption) formData.append("caption", uploadCaption);
      if (uploadLocation) formData.append("location", uploadLocation);

      const res = await fetch("/api/user/photos/upload", {
        method: "POST", credentials: "include", body: formData,
      });
      if (!res.ok) { alert("Upload failed."); return; }
      const newPhoto = await res.json();
      setPhotos((prev) => [newPhoto, ...prev]);
      setUploadSuccess(true);
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadCaption("");
      setUploadLocation("");
      setTimeout(() => { setShowUpload(false); setUploadSuccess(false); }, 1500);
    } catch {
      alert("Upload failed.");
    } finally { setUploading(false); }
  }

  function handleDeletePhoto(photoId: string) {
    setDeletingPhoto({ id: photoId });
  }

  async function confirmDelete() {
    if (!deletingPhoto) return;
    try {
      const res = await fetch(`/api/user/photos/${deletingPhoto.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { alert("Failed to delete photo."); return; }
      setPhotos((prev) => prev.filter((p) => p.id !== deletingPhoto.id));
      setDeletingPhoto(null);
    } catch {
      alert("Failed to delete photo.");
    }
  }

  if (loading) return (
    <AppShell active="more" title="Profile">
      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-40 bg-slate-800 rounded" />
        <div className="flex gap-6">
          <div className="w-24 h-24 rounded-full bg-slate-800" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-48 bg-slate-800 rounded" />
            <div className="h-4 w-32 bg-slate-800 rounded" />
          </div>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell active="more" title="Profile">
      <div className="px-6 pt-6 pb-20 md:px-10 md:pt-10">
        <div className="max-w-4xl mx-auto">
          {/* Back */}
          <button onClick={() => router.back()} className="mb-6 p-2 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white transition-all">
            <ArrowLeft size={16} />
          </button>

          {/* Hero */}
          <div className="flex items-center gap-5 mb-8">
            <PhotoUpload
              currentImage={profile?.image ?? null}
              name={profile?.name ?? ""}
              onUploaded={(url) => setProfile((p: any) => p ? { ...p, image: url } : p)}
            />
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold text-white truncate">{profile?.name}</h1>
              {profile?.username && <p className="font-body text-sm text-amber-400/80">@{profile.username}</p>}
              {profile?.homeLocation && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <MapPin size={13} className="text-amber-400 shrink-0" />
                  <span className="font-body text-sm text-slate-400">{profile.homeLocation.district}, {profile.homeLocation.province}</span>
                </div>
              )}
            </div>
          </div>

          {/* Completed Trips + Wishlist */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Completed Trips */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
              <h2 className="font-display text-base font-bold text-white mb-3 flex items-center gap-2">
                <Calendar size={15} className="text-emerald-400" /> Completed Trips
              </h2>
              {completedTrips.length === 0 ? (
                <p className="font-body text-sm text-slate-500 italic">No completed trips yet</p>
              ) : (
                <div className="space-y-2">
                  {completedTrips.map((trip) => (
                    <Link key={trip.id} href={`/trips/${trip.id}`}
                      className="block p-3 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-emerald-400/20 hover:bg-emerald-400/5 transition-all group">
                      <p className="font-body text-sm text-white font-medium truncate">{trip.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{new Date(trip.startDate).toLocaleDateString()} – {new Date(trip.endDate).toLocaleDateString()}</span>
                        <span>{trip._count.stops} stops</span>
                        <span>{trip._count.members} members</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Wishlist */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
              <h2 className="font-display text-base font-bold text-white mb-3 flex items-center gap-2">
                <Mountain size={15} className="text-amber-400" /> Wishlist
              </h2>
              {wishlist.length === 0 ? (
                <p className="font-body text-sm text-slate-500 italic">No saved destinations yet</p>
              ) : (
                <div className="space-y-2">
                  {wishlist.map((item) => (
                    <div key={item.destination.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                      <div className="min-w-0">
                        <p className="font-body text-sm text-white font-medium truncate">{item.destination.name}</p>
                        <p className="font-body text-xs text-slate-500">{item.destination.district}, {item.destination.province}</p>
                      </div>
                      {item.destination.safetyScore != null && (
                        <span className={`text-xs font-body font-semibold px-2 py-0.5 rounded-full ${
                          item.destination.safetyScore >= 70 ? "bg-emerald-400/10 text-emerald-400" :
                          item.destination.safetyScore >= 40 ? "bg-amber-400/10 text-amber-400" :
                          "bg-red-400/10 text-red-400"
                        }`}>
                          {item.destination.safetyScore}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Trip Photos */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                <Camera size={15} className="text-sky-400" /> Trip Photos
              </h2>
              <button onClick={() => { setShowUpload(!showUpload); setUploadSuccess(false); setSelectedFile(null); setPreviewUrl(null); setUploadCaption(""); setUploadLocation(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 transition-all text-xs font-body font-medium">
                {showUpload ? <X size={13} /> : <Plus size={13} />}
                {showUpload ? "Cancel" : "Add Photo"}
              </button>
            </div>

            {/* Upload form */}
            {showUpload && (
              <div className="mb-6 p-4 rounded-xl border border-sky-400/20 bg-sky-400/5 space-y-3">
                {uploadSuccess ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-emerald-400">
                    <Check size={18} /> Photo uploaded!
                  </div>
                ) : (
                  <>
                    {previewUrl ? (
                      <div className="relative inline-block rounded-lg overflow-hidden border border-slate-700/50">
                        <Image src={previewUrl} alt="Preview" width={300} height={200} className="h-40 object-cover rounded-lg" />
                        <button onClick={() => { setSelectedFile(null); setPreviewUrl(null); }} className="absolute top-1 right-1 p-0.5 bg-slate-900/80 rounded text-slate-400 hover:text-white"><X size={14} /></button>
                      </div>
                    ) : (
                      <button onClick={() => fileInputRef.current?.click()}
                        className="w-full py-8 rounded-lg border-2 border-dashed border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all flex flex-col items-center gap-2 font-body text-sm">
                        <ImageIcon size={24} />
                        Click to choose a photo
                      </button>
                    )}
                    <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />

                    <input value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} placeholder="Caption (optional)"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-sky-500/50" />

                    <input value={uploadLocation} onChange={(e) => setUploadLocation(e.target.value)} placeholder="Location, e.g. Pokhara, Nepal (optional)"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-sky-500/50" />

                    <button onClick={handleUpload} disabled={!selectedFile || uploading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-body font-semibold transition-all disabled:opacity-50">
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                      {uploading ? "Uploading…" : "Upload Photo"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Masonry gallery */}
            {photos.length === 0 ? (
              <p className="font-body text-sm text-slate-500 italic py-8 text-center">No photos yet — add your first trip photo!</p>
            ) : (
              <div className="columns-2 md:columns-3 gap-3 space-y-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="break-inside-avoid rounded-xl overflow-hidden border border-slate-700/50 bg-slate-800/60 group relative">
                    <Image src={photo.imageUrl} alt={photo.caption ?? "Trip photo"} width={600} height={400}
                      className="w-full h-auto object-cover" unoptimized />
                    <button onClick={() => handleDeletePhoto(photo.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <Trash2 size={14} />
                    </button>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        {photo.caption && <p className="font-body text-sm text-white">{photo.caption}</p>}
                        {photo.location && <p className="font-body text-xs text-slate-300 mt-0.5 flex items-center gap-1"><MapPin size={10} />{photo.location}</p>}
                      </div>
                    </div>
                    {photo.caption && (
                      <div className="p-2 md:hidden">
                        <p className="font-body text-xs text-slate-300 truncate">{photo.caption}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={!!deletingPhoto} onOpenChange={(open) => !open && setDeletingPhoto(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete photo?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
