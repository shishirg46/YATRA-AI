"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Route,
  Map,
  BarChart3,
  History,
  Settings,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Mountain,
  UserCheck
} from "lucide-react";
import { authClient } from "@/lib/auth-client";

type AdminActiveTab =
  | "dashboard"
  | "users"
  | "destinations"
  | "verification"
  | "hazards"
  | "routes"
  | "map"
  | "analytics"
  | "audit-logs"
  | "settings";

interface AdminShellProps {
  children: React.ReactNode;
  active: AdminActiveTab;
  title?: string;
}

export function AdminShell({ children, active, title }: AdminShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = [
    { id: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, color: "text-blue-400" },
    { id: "users", label: "Users", href: "/admin/users", icon: Users, color: "text-purple-400" },
    { id: "destinations", label: "Destinations", href: "/admin/destinations", icon: MapPin, color: "text-sky-400" },
    { id: "verification", label: "Verification Queue", href: "/admin/verification", icon: CheckCircle2, color: "text-emerald-400" },
    { id: "hazards", label: "Hazards & Disasters", href: "/admin/hazards", icon: AlertTriangle, color: "text-red-400" },
    { id: "routes", label: "Route Graph", href: "/admin/routes", icon: Route, color: "text-cyan-400" },
    { id: "map", label: "Map Explorer", href: "/admin/map", icon: Map, color: "text-teal-400" },
    { id: "analytics", label: "Analytics", href: "/admin/analytics", icon: BarChart3, color: "text-amber-400" },
    { id: "audit-logs", label: "Audit Logs", href: "/admin/audit-logs", icon: History, color: "text-orange-400" },
    { id: "settings", label: "Settings", href: "/admin/settings", icon: Settings, color: "text-slate-400" },
  ];

  async function handleLogout() {
    try {
      await authClient.signOut();
      router.push("/sign-in");
    } catch (err) {
      console.error("Signout failed", err);
    }
  }

  return (
    <div className="yatra-page min-h-screen bg-[#0a0f1d] text-slate-100 flex relative overflow-hidden">
      {/* Decorative Glow Spots */}
      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/5 -top-32 -left-32 pointer-events-none fixed" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/5 bottom-0 right-0 pointer-events-none fixed" />

      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-800/80 bg-slate-950/85 backdrop-blur-xl transition-all duration-350 z-30 shrink-0 ${
          collapsed ? "w-20" : "w-64"
        }`}
      >
        {/* Brand */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-900">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5 min-w-0">
            <Mountain className="text-amber-400 shrink-0" size={24} />
            {!collapsed && (
              <span className="font-display font-extrabold text-lg text-white tracking-tight truncate">
                YatraAI <span className="text-xs text-amber-500 font-semibold px-1 py-0.5 bg-amber-500/10 rounded ml-1">Admin</span>
              </span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-colors"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                  isActive
                    ? "bg-amber-400/10 border border-amber-400/20 text-amber-400 font-semibold"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/60"
                }`}
              >
                <Icon
                  size={19}
                  className={`transition-colors shrink-0 ${isActive ? item.color : "text-slate-450 group-hover:text-slate-200"}`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-slate-900 space-y-1 bg-slate-950/40">
          <Link
            href="/dashboard?mode=user"
            className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-900 transition-colors group"
          >
            <UserCheck size={19} className="text-slate-450 group-hover:text-emerald-400 shrink-0" />
            {!collapsed && <span className="truncate">Switch to User Mode</span>}
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-950/15 transition-colors group"
          >
            <LogOut size={19} className="text-slate-450 group-hover:text-red-400 shrink-0" />
            {!collapsed && <span className="truncate">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer (Overlay) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-64 bg-slate-950 border-r border-slate-800 z-50 md:hidden flex flex-col transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-900">
          <span className="font-display font-extrabold text-lg text-white tracking-tight flex items-center gap-2">
            <Mountain className="text-amber-400" size={24} />
            YatraAI <span className="text-xs text-amber-500 font-semibold px-1.5 py-0.5 bg-amber-500/10 rounded">Admin</span>
          </span>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-amber-400/10 border border-amber-400/20 text-amber-400 font-semibold"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                }`}
              >
                <Icon size={19} className={isActive ? item.color : "text-slate-450"} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-900 space-y-1">
          <Link
            href="/dashboard?mode=user"
            className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
          >
            <UserCheck size={19} className="text-slate-450" />
            <span className="truncate">Switch to User Mode</span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-900 transition-colors"
          >
            <LogOut size={19} className="text-slate-450" />
            <span className="truncate">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Navbar */}
        <header className="h-16 border-b border-slate-900 bg-slate-950/45 backdrop-blur-md px-4 md:px-8 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-colors"
            >
              <Menu size={20} />
            </button>
            {title && (
              <h2 className="font-display text-lg font-bold text-white tracking-tight md:text-xl">
                {title}
              </h2>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard?mode=user"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-all"
            >
              <UserCheck size={13} />
              User Portal
            </Link>
          </div>
        </header>

        {/* Content Wrapper */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
