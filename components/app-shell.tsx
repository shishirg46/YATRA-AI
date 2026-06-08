"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboard,
  MapPinned,
  Mountain,
  NotebookPen,
  Sparkles,
} from "lucide-react";

export type AppNavId = "dashboard" | "plan" | "trips" | "more" | "accessibility";

type AppShellProps = {
  children: React.ReactNode;
  active?: AppNavId;
  title?: string;
  actions?: React.ReactNode;
  center?: React.ReactNode;
  subpage?: boolean;
  onBack?: () => void;
  showMobileNav?: boolean;
  contentClassName?: string;
};

const MOBILE_NAV: { id: AppNavId; href: string; label: string; icon: typeof Mountain }[] = [
  { id: "dashboard", href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { id: "plan", href: "/plan", label: "Plan", icon: MapPinned },
  { id: "trips", href: "/trips", label: "Trips", icon: NotebookPen },
  { id: "more", href: "/more", label: "More", icon: Sparkles },
];

export function AppShell({
  children,
  active,
  title,
  actions,
  center,
  subpage = false,
  onBack,
  showMobileNav = true,
  contentClassName = "pt-16 max-w-7xl mx-auto px-4 md:px-8 py-8 relative",
}: AppShellProps) {
  const router = useRouter();
  const bottomPad = showMobileNav && active ? "pb-20 md:pb-8" : "";

  return (
    <div className="yatra-page">
      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/8 -top-32 -left-32 pointer-events-none fixed" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/6 bottom-0 right-0 pointer-events-none fixed" />

      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {subpage ? (
            <button
              type="button"
              onClick={onBack ?? (() => router.back())}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm shrink-0"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back</span>
            </button>
          ) : null}
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            <span className="flex size-9 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 shadow-[0_0_28px_rgba(245,158,11,.14)]">
              <Mountain className="text-amber-300 shrink-0" size={19} />
            </span>
            <span className="font-display font-bold text-lg text-white tracking-tight truncate">
              YatraAI
            </span>
          </Link>
          {title ? (
            <>
              <span className="text-slate-700 hidden sm:inline">·</span>
              <span className="font-body text-sm text-slate-400 truncate hidden sm:inline">
                {title}
              </span>
            </>
          ) : null}
        </div>

        {center ? (
          <div className="absolute left-1/2 hidden -translate-x-1/2 md:block">{center}</div>
        ) : null}

        {actions ? (
          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">{actions}</div>
        ) : null}
      </nav>

      <main className={`${contentClassName} ${bottomPad}`}>{children}</main>

      {showMobileNav && active ? (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-white/6 bg-[rgba(10,15,30,0.96)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
          aria-label="Main"
        >
          <div className="grid grid-cols-4 h-14">
            {MOBILE_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-0.5 font-body text-[10px] transition-colors ${
                    isActive ? "text-amber-400" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
