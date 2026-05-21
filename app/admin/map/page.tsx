/**
 * FILE: page.tsx
 * LOCATION: /app/admin/map/page.tsx
 * PURPOSE: Interactive administrative map visualization page
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronLeft, Layers, Map, Eye, AlertCircle, Loader2, Info } from "lucide-react";
import { AppShell } from "@/components/app-shell";

// Dynamically load interactive map
const AdminInteractiveMap = dynamic(() => import("@/components/admin-interactive-map"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full rounded-xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center text-slate-500 font-body">
      <Loader2 className="animate-spin text-amber-400 mb-2" size={32} />
      <p>Initializing Nepal geographic map layer canvas…</p>
    </div>
  ),
});

export default function AdminMapPage() {
  const router = useRouter();

  // Control Toggles
  const [showDestinations, setShowDestinations] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);

  // Data states
  const [destinations, setDestinations] = useState([]);
  const [hazards, setHazards] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMapData();
  }, []);

  async function fetchMapData() {
    try {
      setLoading(true);
      const [destRes, hazRes, nodesRes, edgesRes] = await Promise.all([
        fetch("/api/admin/destinations?limit=1000", { credentials: "include" }),
        fetch("/api/admin/hazards?limit=1000", { credentials: "include" }),
        fetch("/api/admin/routes/nodes?limit=1000", { credentials: "include" }),
        fetch("/api/admin/routes/edges?limit=1000", { credentials: "include" })
      ]);

      if (!destRes.ok || !hazRes.ok || !nodesRes.ok || !edgesRes.ok) {
        throw new Error("Failed to load map data");
      }

      const destData = await destRes.json();
      const hazData = await hazRes.json();
      const nodesData = await nodesRes.json();
      const edgesData = await edgesRes.json();

      setDestinations(destData.destinations || []);
      
      // Map hazards to list with location references
      const formattedHazards = (hazData.hazards || []).map((h: any) => {
        // Calculate severity level matching page logic
        const f = h.floodIndex || 0;
        const l = h.landslideIndex || 0;
        const heat = h.heatIndex || 0;
        const air = h.airQuality || 0;
        const penalty = (f * 25) + (l * 25) + (heat * 5) + (air * 5);
        const score = 100 - penalty;
        let severity: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME" = "SAFE";
        if (score < 40) severity = "EXTREME";
        else if (score < 60) severity = "HIGH_RISK";
        else if (score < 80) severity = "CAUTION";

        return {
          id: h.id,
          latitude: h.location.latitude,
          longitude: h.location.longitude,
          locationName: h.location.name,
          severity,
          floodIndex: f,
          landslideIndex: l,
        };
      });
      setHazards(formattedHazards);

      setNodes(nodesData.nodes || []);
      setEdges(edgesData.edges || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell active="dashboard" title="Admin Map View" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ChevronLeft size={18} className="text-slate-400" />
            <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
              Back to Admin
            </Link>
          </div>
          <h1 className="font-display text-3xl font-bold text-white flex items-center gap-2">
            <Map className="text-amber-400" /> Administrative Map Explorer
          </h1>
          <p className="font-body text-slate-400 mt-1">
            Visual inspection map of routing networks, verified locations and real-time hazard radius circles
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={38} />
          <p className="font-body text-slate-400">Loading geospatial layers data…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-230px)] min-h-[500px]">
          {/* Controls Sidebar */}
          <div className="lg:col-span-1 stat-card p-4 flex flex-col justify-between font-body text-xs text-slate-400">
            <div className="space-y-6">
              <div>
                <h3 className="font-display text-sm font-bold text-white flex items-center gap-1.5 mb-3">
                  <Layers size={14} className="text-amber-400" /> Map Overlays Control
                </h3>
                
                <div className="space-y-3">
                  <label className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showDestinations}
                      onChange={(e) => setShowDestinations(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                    />
                    <div>
                      <p className="font-semibold text-white">Tourist Destinations</p>
                      <p className="text-[10px] text-slate-500">Show pins of cataloged spots</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHazards}
                      onChange={(e) => setShowHazards(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                    />
                    <div>
                      <p className="font-semibold text-white">Disaster Alert Circles</p>
                      <p className="text-[10px] text-slate-500">Circle overlays for active risks</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showRoutes}
                      onChange={(e) => setShowRoutes(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                    />
                    <div>
                      <p className="font-semibold text-white">Transit Route Network</p>
                      <p className="text-[10px] text-slate-500">Render waypoint nodes and highway lines</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Map Legend */}
              <div className="border-t border-slate-800 pt-4">
                <h4 className="font-semibold text-white mb-2 uppercase tracking-widest text-[9px]">Legend Indicators</h4>
                <div className="space-y-2 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white"></span>
                    <span>Verified Destination</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 border border-white animate-pulse"></span>
                    <span>Unverified Destination</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-900"></span>
                    <span>Transit Graph Hub</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-1 bg-sky-400 rounded"></span>
                    <span>Highway Road Connection</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4 flex gap-2 text-[10px] text-slate-500">
              <Info size={14} className="flex-shrink-0 mt-0.5" />
              <p>Hover over map items or circles to inspect specific coordinate metrics.</p>
            </div>
          </div>

          {/* Interactive Map view */}
          <div className="lg:col-span-3 h-full">
            <AdminInteractiveMap
              destinations={destinations}
              hazards={hazards}
              nodes={nodes}
              edges={edges}
              showDestinations={showDestinations}
              showHazards={showHazards}
              showRoutes={showRoutes}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
