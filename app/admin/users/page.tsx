/**
 * FILE: page.tsx
 * LOCATION: /app/admin/users/page.tsx
 * PURPOSE: User management — search, filter, edit roles/status, soft delete, view health/preferences/trips
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ChevronLeft, Loader2, Shield, User as UserIcon, Search, 
  Trash2, Edit, Eye, Check, X, ChevronLeft as PrevIcon, 
  ChevronRight as NextIcon, Activity, Heart, Compass, MapPin
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

interface UserSummary {
  id: string;
  name: string;
  username: string | null;
  email: string;
  role: "USER" | "ADMIN" | "ANALYST";
  isActive: boolean;
  createdAt: string;
}

interface UserHealth {
  bloodType: string | null;
  fitnessLevel: string;
  mobilityLimited: boolean;
  chronicConditions: string[];
  allergies: string[];
}

interface UserPreference {
  interests: string[];
  riskTolerance: string;
  travelStyle: string[];
  maxDistanceKm: number | null;
  typicalDurationDays: number | null;
  locationLat: number | null;
  locationLng: number | null;
}

interface TravelPlanSummary {
  id: string;
  title: string;
  tripType: string;
  status: string;
  startDate: string;
  endDate: string;
  budgetNPR: number | null;
  createdAt: string;
  _count: { stops: number };
}

interface UserDetail extends UserSummary {
  health: UserHealth | null;
  preference: UserPreference | null;
  behavior: { metrics: any } | null;
  travelPlans: TravelPlanSummary[];
}

export default function UsersPage() {
  const router = useRouter();
  
  // Table state
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination & Filters
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);

  // Detail Modal State
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<"profile" | "health" | "history">("profile");

  // Edit Modal State
  const [editUser, setEditUser] = useState<UserSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN" | "ANALYST">("USER");
  const [editIsActive, setEditIsActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [page, roleFilter, activeFilter]);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchUsers();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  async function fetchUsers() {
    try {
      setLoading(true);
      setError(null);
      
      const query = new URLSearchParams({
        search,
        role: roleFilter,
        isActive: activeFilter,
        page: page.toString(),
        limit: "10"
      });

      const res = await fetch(`/api/admin/users?${query.toString()}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to load users: ${res.status}`);
      }
      const data = await res.json();
      setUsers(data.users || []);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalUsers(data.pagination.total || 0);
    } catch (err) {
      console.error("[users list]", err);
      setError("Failed to load user management data.");
    } finally {
      setLoading(false);
    }
  }

  async function viewDetails(userId: string) {
    try {
      setLoadingDetail(true);
      setDetailTab("profile");
      const res = await fetch(`/api/admin/users/${userId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user details");
      const data = await res.json();
      setSelectedUser(data);
    } catch (err) {
      toast.error("Could not fetch user details.");
    } finally {
      setLoadingDetail(false);
    }
  }

  function openEditModal(user: UserSummary) {
    setEditUser(user);
    setEditName(user.name);
    setEditUsername(user.username || "");
    setEditRole(user.role);
    setEditIsActive(user.isActive);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    try {
      setSavingEdit(true);
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          username: editUsername,
          role: editRole,
          isActive: editIsActive
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save user");
      }

      toast.success("User updated successfully");
      setEditUser(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to update user.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteUser(userId: string) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to delete user");
      
      toast.success("User soft deleted successfully");
      setDeletingId(null);
      fetchUsers();
    } catch (err) {
      toast.error("Could not delete user.");
    }
  }

  return (
    <AppShell active="dashboard" title="User Management" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
            Back to Admin
          </Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white">User Management</h1>
        <p className="font-body text-slate-400 mt-1">Search, modify roles, monitor health settings, and audit users</p>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-6 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search by name, email, or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700/50 text-white"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Roles</option>
            <option value="USER">USER</option>
            <option value="ANALYST">ANALYST</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <select
            value={activeFilter}
            onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/50 text-slate-300 font-body text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="">All Statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={36} />
          <p className="font-body text-slate-400">Fetching users from database…</p>
        </div>
      ) : error ? (
        <div className="stat-card p-4 bg-red-400/10 border-red-500/30 text-red-300">{error}</div>
      ) : (
        <div className="stat-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-widest">
                  <th className="py-3 px-4 font-body">User</th>
                  <th className="py-3 px-4 font-body">Email</th>
                  <th className="py-3 px-4 font-body">Role</th>
                  <th className="py-3 px-4 font-body text-center">Status</th>
                  <th className="py-3 px-4 font-body">Joined</th>
                  <th className="py-3 px-4 font-body text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-body">
                      No users matching current criteria.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-800/20 transition-colors font-body text-sm">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-semibold text-white">{user.name}</p>
                          <p className="text-xs text-slate-500">
                            {user.username ? `@${user.username}` : "no-username"}
                          </p>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{user.email}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            user.role === "ADMIN"
                              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              : user.role === "ANALYST"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-slate-800 text-slate-400 border border-slate-700/50"
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
                            user.isActive
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {user.isActive ? <Check size={12} /> : <X size={12} />}
                          {user.isActive ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => viewDetails(user.id)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => openEditModal(user)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Edit User"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => setDeletingId(user.id)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                            title="Delete User"
                          >
                            <Trash2 size={16} />
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
              <p>Showing {(page - 1) * 10 + 1} - {Math.min(page * 10, totalUsers)} of {totalUsers} users</p>
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

      {/* USER DETAIL MODAL */}
      <Dialog open={selectedUser !== null} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-2xl bg-slate-950 border border-slate-800 text-white rounded-xl">
          {selectedUser && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 rounded-full text-amber-400">
                    <UserIcon size={24} />
                  </div>
                  <div>
                    <DialogTitle className="text-xl font-bold text-white">{selectedUser.name}</DialogTitle>
                    <DialogDescription className="text-xs text-slate-400 font-body">
                      User details, safety configuration, and activity logs
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* Tab Navigation */}
              <div className="flex border-b border-slate-850 mb-4 font-body text-sm">
                {(["profile", "health", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={`px-4 py-2 border-b-2 font-semibold capitalize transition-colors ${
                      detailTab === tab
                        ? "border-amber-400 text-amber-400"
                        : "border-transparent text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {tab === "profile" ? "Profile & Activity" : tab === "health" ? "Health & Prefs" : "Travel History"}
                  </button>
                ))}
              </div>

              {/* Tab Contents */}
              <div className="max-h-96 overflow-y-auto pr-1">
                {detailTab === "profile" && (
                  <div className="space-y-4 font-body">
                    <div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/40">
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Email Address</p>
                        <p className="text-sm text-white font-semibold">{selectedUser.email}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Username Handle</p>
                        <p className="text-sm text-white font-semibold">
                          {selectedUser.username ? `@${selectedUser.username}` : "None"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Role Permission</p>
                        <p className="text-sm text-amber-400 font-semibold">{selectedUser.role}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Account Status</p>
                        <p className={`text-sm font-semibold ${selectedUser.isActive ? "text-emerald-400" : "text-red-400"}`}>
                          {selectedUser.isActive ? "Active" : "Suspended / Suspicious"}
                        </p>
                      </div>
                    </div>

                    {/* Behavioral Statistics */}
                    <div>
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-2">
                        <Activity size={16} className="text-amber-400" /> Behavioral Interactions
                      </h4>
                      {selectedUser.behavior?.metrics ? (
                        <pre className="bg-slate-900 p-3 rounded border border-slate-800 text-xs text-slate-400 overflow-x-auto">
                          {JSON.stringify(selectedUser.behavior.metrics, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-xs text-slate-500 bg-slate-900/30 p-4 text-center rounded border border-dashed border-slate-800">
                          No behavior profile registered for this account.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {detailTab === "health" && (
                  <div className="space-y-4 font-body">
                    {/* UserHealth */}
                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-4">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-white mb-3">
                        <Heart size={16} className="text-red-400" /> Medical & Health Status
                      </h4>
                      {selectedUser.health ? (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-slate-500">Blood Type</p>
                            <p className="text-slate-200 font-semibold">{selectedUser.health.bloodType || "Unspecified"}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Fitness Condition</p>
                            <p className="text-slate-200 font-semibold">{selectedUser.health.fitnessLevel}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Limited Mobility</p>
                            <p className="text-slate-200 font-semibold">{selectedUser.health.mobilityLimited ? "Yes" : "No"}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-slate-500 mb-1">Chronic Conditions</p>
                            {selectedUser.health.chronicConditions.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {selectedUser.health.chronicConditions.map((c) => (
                                  <span key={c} className="px-2 py-0.5 bg-red-950/40 text-red-300 border border-red-900/30 rounded text-[10px] uppercase font-bold">{c}</span>
                                ))}
                              </div>
                            ) : <p className="text-slate-400 italic">None reported</p>}
                          </div>
                          <div className="col-span-2">
                            <p className="text-slate-500 mb-1">Allergies</p>
                            {selectedUser.health.allergies.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {selectedUser.health.allergies.map((a) => (
                                  <span key={a} className="px-2 py-0.5 bg-orange-950/40 text-orange-300 border border-orange-900/30 rounded text-[10px] uppercase font-bold">{a}</span>
                                ))}
                              </div>
                            ) : <p className="text-slate-400 italic">None reported</p>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">Health profile onboarding has not been completed.</p>
                      )}
                    </div>

                    {/* UserPreference */}
                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-4">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-white mb-3">
                        <Compass size={16} className="text-amber-400" /> Travel System Preferences
                      </h4>
                      {selectedUser.preference ? (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-slate-500">Risk Appetite</p>
                            <p className="text-amber-400 font-bold uppercase tracking-wider">{selectedUser.preference.riskTolerance}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Typical Trip Length</p>
                            <p className="text-slate-200 font-semibold">{selectedUser.preference.typicalDurationDays ? `${selectedUser.preference.typicalDurationDays} Days` : "Uncapped"}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Maximum Route Radius</p>
                            <p className="text-slate-200 font-semibold">{selectedUser.preference.maxDistanceKm ? `${selectedUser.preference.maxDistanceKm} Km` : "Uncapped"}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-slate-500 mb-1">Primary Travel Interests</p>
                            {selectedUser.preference.interests.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {selectedUser.preference.interests.map((i) => (
                                  <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded text-[10px]">{i}</span>
                                ))}
                              </div>
                            ) : <p className="text-slate-400 italic">None selected</p>}
                          </div>
                          <div className="col-span-2">
                            <p className="text-slate-500 mb-1">Travel Modality</p>
                            {selectedUser.preference.travelStyle.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {selectedUser.preference.travelStyle.map((s) => (
                                  <span key={s} className="px-2 py-0.5 bg-amber-950/20 text-amber-300 border border-amber-900/30 rounded text-[10px]">{s}</span>
                                ))}
                              </div>
                            ) : <p className="text-slate-400 italic">None selected</p>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">Travel preference settings have not been configured.</p>
                      )}
                    </div>
                  </div>
                )}

                {detailTab === "history" && (
                  <div className="space-y-3 font-body">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold text-white mb-2">
                      <MapPin size={16} className="text-sky-400" /> Travel Plans & Safety Reports
                    </h4>
                    {selectedUser.travelPlans.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-900/20 border border-dashed border-slate-800 py-6 text-center rounded">
                        This user hasn't generated any route travel plans yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedUser.travelPlans.map((plan) => (
                          <div key={plan.id} className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                            <div>
                              <p className="font-semibold text-white text-sm mb-0.5">{plan.title}</p>
                              <p className="text-slate-400">
                                {new Date(plan.startDate).toLocaleDateString()} to {new Date(plan.endDate).toLocaleDateString()}
                              </p>
                              <div className="flex gap-2 mt-1">
                                <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[9px] uppercase tracking-wider">{plan.tripType}</span>
                                <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[9px] uppercase tracking-wider">{plan.status}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-white font-bold">{plan.budgetNPR ? `NPR ${plan.budgetNPR.toLocaleString()}` : "Budget: N/A"}</p>
                              <p className="text-slate-500 text-[10px]">{plan._count.stops} Planned Stops</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT USER MODAL */}
      <Dialog open={editUser !== null} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Edit User Record</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Modify account parameters. Admin changes are immediately audited.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-slate-900 border-slate-700/60 text-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Username Handle</label>
              <Input
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="e.g. nepal_traveler"
                className="bg-slate-900 border-slate-700/60 text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">User Role</label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
              >
                <option value="USER">USER</option>
                <option value="ANALYST">ANALYST</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-850">
              <div>
                <p className="text-xs font-semibold text-white uppercase tracking-wider">Account Active</p>
                <p className="text-[11px] text-slate-500">Uncheck to suspend login capabilities</p>
              </div>
              <input
                type="checkbox"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
                className="w-4 height-4 rounded border-slate-700 text-amber-500 accent-amber-500 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditUser(null)}
                className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingEdit}
                className="bg-amber-400 text-slate-950 font-semibold hover:bg-amber-500"
              >
                {savingEdit ? "Saving Changes…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* SOFT DELETE CONFIRMATION */}
      <Dialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Suspend and Delete Account?</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Are you sure you want to soft delete this user? They will be blocked from logging in, and their user data will be hidden from searches. This action can be undone by an admin.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              No, Cancel
            </Button>
            <Button
              onClick={() => deletingId && handleDeleteUser(deletingId)}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              Yes, Soft Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
