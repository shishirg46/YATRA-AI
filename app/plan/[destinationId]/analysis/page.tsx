"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import PlanReportView from "@/components/plan-report-view";
import type { PlanReport } from "@/lib/types/plan-report";

function AnalysisInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destId = params.destinationId as string;

  const destName = searchParams.get("name") ?? "";
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const tripType = (searchParams.get("type") as "SOLO" | "GROUP" | null) ?? "SOLO";
  const vehicle = searchParams.get("vehicle") ?? "car";
  const travelStyle = searchParams.get("style") ?? "standard";
  const qOriginLat = searchParams.get("originLat");
  const qOriginLon = searchParams.get("originLon");
  const qBudget = searchParams.get("budget");

  const [report, setReport] = useState<PlanReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!destId || !startDate || !endDate) {
      setError("Missing destination or travel dates.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);

        let originLat = qOriginLat ? Number(qOriginLat) : null;
        let originLon = qOriginLon ? Number(qOriginLon) : null;

        if (!Number.isFinite(originLat) || !Number.isFinite(originLon)) {
          originLat = null;
          originLon = null;
        }

        const res = await fetch("/api/plan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinationId: destId,
            startDate,
            endDate,
            tripType,
            vehicle,
            travelStyle,
            budgetNPR: parseInt(qBudget ?? "0", 10),
            originLat,
            originLon,
            memberUsernames: [],
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? "Analysis failed.");
          return;
        }

        setReport(data);
      } catch (err) {
        setError(`Failed: ${String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [destId, startDate, endDate, tripType, vehicle, travelStyle, qOriginLat, qOriginLon, qBudget]);

  function buildSavePayload(r: PlanReport, mode: "ANALYZED" | "PENDING") {
    return {
      title: `${r.destination.name} ${r.startDate}`,
      tripType: r.tripType as "SOLO" | "GROUP",
      startDate: r.startDate,
      endDate: r.endDate,
      budgetNPR: r.budget?.specified ?? 0,
      stops: [{ locationId: r.destination.id, stopOrder: 1, arrivalDate: r.startDate, departureDate: r.endDate }],
      memberUsernames: (r.memberAnalyses ?? []).filter((m) => !m.isLeader && !!m.username).map((m) => String(m.username)),
      status: mode,
      groupRiskResult: {
        overallLevel: r.overallLevel,
        overallScore: r.overallScore,
        confidence: r.confidence,
        routeRisk: r.routeRisk,
        riskFactors: r.riskFactors,
        recommendations: r.recommendations,
        analyzedAt: r.analyzedAt,
      },
      stopRiskSnapshot: {
        overallLevel: r.overallLevel,
        overallScore: r.overallScore,
        routeRisk: r.routeRisk,
        destination: r.destination,
        travelDate: r.travelDate,
      },
    };
  }

  async function handleSave(mode: "ANALYZED" | "PENDING") {
    if (!report) return;
    const payload = buildSavePayload(report, mode);
    const res = await fetch("/api/trips", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Failed to save plan.");
    setSavedPlanId(data.id);
    router.push(`/trips/${data.id}`);
  }

  async function handleUpdate() {
    if (!report || !savedPlanId) return;
    const payload = buildSavePayload(report, "ANALYZED");
    const res = await fetch(`/api/trips/${savedPlanId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Failed to update plan.");
    router.push(`/trips/${savedPlanId}`);
  }

  function handlePlanAlternative(alt: { id: string; name: string; district: string; province: string; altitude: number | null }) {
    const params = new URLSearchParams();
    params.set("destination", alt.id);
    params.set("name", alt.name);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("type", tripType);
    params.set("vehicle", vehicle);
    params.set("style", travelStyle);
    router.push(`/plan?${params.toString()}`);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 size={38} className="animate-spin text-amber-400 mb-3" />
        <p className="font-body text-sm text-slate-400">
          Analysing trip safety for {destName || destId}…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <p className="font-body text-red-400 mb-4">{error}</p>
        <Link href="/plan" className="text-amber-400 hover:text-amber-300 font-body text-sm underline">
          ← Back to plan form
        </Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <p className="font-body text-slate-400 mb-4">No analysis data available.</p>
        <Link href="/plan" className="text-amber-400 hover:text-amber-300 font-body text-sm underline">
          ← Plan a trip
        </Link>
      </div>
    );
  }

  return (
    <PlanReportView
      report={report}
      isGroup={tripType === "GROUP"}
      displayOriginLat={qOriginLat ? Number(qOriginLat) : null}
      displayOriginLon={qOriginLon ? Number(qOriginLon) : null}
      hasSavedPlan={!!savedPlanId}
      onBack={() => router.push("/plan")}
      onSave={handleSave}
      onUpdate={handleUpdate}
      onPlanAlternative={handlePlanAlternative}
    />
  );
}

export default function AnalysisPage() {
  return (
    <AppShell active="plan" title="Trip Analysis" subpage contentClassName="pt-20 w-full px-4 md:px-6 lg:px-8 pb-20 relative z-10">
      <AnalysisInner />
    </AppShell>
  );
}
