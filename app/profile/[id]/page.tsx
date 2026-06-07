"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, MapPin, Calendar, Mountain, Camera, Shield, User } from "lucide-react";
import { AppShell } from "@/components/app-shell";

type ProfileData = {
  id: string; name?: string; username?: string | null; image: string | null;
  homeLocation?: { name: string; district: { name: string; province: { name: string } } } | null;
  isOwn: boolean; isFriend: boolean;
  stats: { tripPhotos: number; travelPlans: number };
};

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams();
  const userId = params?.id as string;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, photosRes, tripsRes] = await Promise.all([
        fetch(`/api/profile/${userId}`, { credentials: "include" }),
        fetch(`/api/profile/${userId}/photos`, { credentials: "include" }),
        fetch(`/api/profile/${userId}/trips`, { credentials: "include" }),
      ]);
      if (!profileRes.ok) { router.push("/sign-in"); return; }
      setProfile(await profileRes.json());
      if (photosRes.ok) {
        const pd = await photosRes.json();
        setPhotos(pd.photos ?? []);
      }
      if (tripsRes.ok) {
        const td = await tripsRes.json();
        setTrips(td.completedTrips ?? []);
      }
    } catch {} finally { setLoading(false); }
  }, [userId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  if (!profile) return null;

  return (
    <AppShell active="more" title={profile.name ?? "Profile"}>
      <div className="px-6 pt-6 pb-20 md:px-10 md:pt-10">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => router.back()} className="mb-6 p-2 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white transition-all">
            <ArrowLeft size={16} />
          </button>

          {/* Hero */}
          <div className="flex items-center gap-5 mb-8">
            {profile.image ? (
              <Image src={profile.image} alt={profile.name ?? "User"} width={80} height={80}
                className="w-20 h-20 rounded-full object-cover border-2 border-slate-600" unoptimized />
            ) : (
              <div className="w-20 h-20 rounded-full bg-amber-400/20 border-2 border-amber-400/30 flex items-center justify-center">
                <User size={32} className="text-amber-400" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {profile.name && <h1 className="font-display text-2xl font-bold text-white truncate">{profile.name}</h1>}
                {profile.isFriend && <Shield size={14} className="text-emerald-400 shrink-0" aria-label="Friend" />}
              </div>
              {profile.username && <p className="font-body text-sm text-amber-400/80">@{profile.username}</p>}
              {profile.homeLocation && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <MapPin size={13} className="text-amber-400 shrink-0" />
                  <span className="font-body text-sm text-slate-400">
                    {profile.homeLocation.district.name}, {profile.homeLocation.district.province.name}
                  </span>
                </div>
              )}
              <div className="flex gap-4 mt-2 text-xs text-slate-500">
                <span>{profile.stats?.travelPlans ?? 0} trips</span>
                <span>{profile.stats?.tripPhotos ?? 0} photos</span>
              </div>
            </div>
          </div>

          {/* Completed Trips */}
          {trips.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display text-base font-bold text-white mb-3 flex items-center gap-2">
                <Calendar size={15} className="text-emerald-400" /> Completed Trips
              </h2>
              <div className="space-y-2">
                {trips.map((trip: any) => (
                  <Link key={trip.id} href={`/trips/${trip.id}`}
                    className="block p-3 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-emerald-400/20 transition-all group">
                    <p className="font-body text-sm text-white font-medium truncate">{trip.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>{new Date(trip.startDate).toLocaleDateString()} – {new Date(trip.endDate).toLocaleDateString()}</span>
                      {trip.leader && <span>by {trip.leader.name}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
              <h2 className="font-display text-base font-bold text-white mb-3 flex items-center gap-2">
                <Camera size={15} className="text-sky-400" /> Trip Photos
              </h2>
              <div className="columns-2 md:columns-3 gap-3 space-y-3">
                {photos.map((photo: any) => (
                  <div key={photo.id} className="break-inside-avoid rounded-xl overflow-hidden border border-slate-700/50 bg-slate-800/60 group relative">
                    <Image src={photo.imageUrl} alt={photo.caption ?? "Trip photo"} width={600} height={400}
                      className="w-full h-auto object-cover" unoptimized />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        {photo.caption && <p className="font-body text-sm text-white">{photo.caption}</p>}
                        {photo.location && <p className="font-body text-xs text-slate-300 mt-0.5 flex items-center gap-1"><MapPin size={10} />{photo.location}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!profile.name && !profile.username && trips.length === 0 && photos.length === 0 && (
            <div className="text-center py-16">
              <Shield size={32} className="text-slate-700 mx-auto mb-3" />
              <p className="font-body text-slate-500">This profile is private.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
