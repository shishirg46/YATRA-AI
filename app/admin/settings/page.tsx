/**
 * FILE: page.tsx
 * LOCATION: /app/admin/settings/page.tsx
 * PURPOSE: Admin settings and configuration
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Settings as SettingsIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function SettingsPage() {
  const router = useRouter();

  return (
    <AppShell active="dashboard" title="Settings" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
            Back to Admin
          </Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white">Admin Settings</h1>
        <p className="font-body text-slate-400 mt-1">Configure system settings and preferences</p>
      </div>

      <div className="stat-card p-8 border border-slate-700/50 rounded-xl text-center">
        <SettingsIcon size={48} className="text-slate-600 mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold text-white mb-2">Coming Soon</h3>
        <p className="font-body text-slate-400">
          Admin settings panel for system configuration will be available soon.
        </p>
      </div>
    </AppShell>
  );
}
