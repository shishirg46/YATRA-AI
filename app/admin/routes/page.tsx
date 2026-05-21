/**
 * FILE: page.tsx
 * LOCATION: /app/admin/routes/page.tsx
 * PURPOSE: Route Graph Management — nodes, edges, snapping and map-based visualization
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { 
  ChevronLeft, Search, Plus, Edit, Trash2, MapPin, Navigation, 
  GitCommit, Layers, AlertCircle, Loader2, Info
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

// Load Leaflet map dynamically with no SSR
const RouteGraphMap = dynamic(() => import("@/components/route-graph-map"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full rounded-xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center text-slate-500 font-body">
      <Loader2 className="animate-spin text-amber-400 mb-2" size={32} />
      <p>Initializing spatial engine map viewer…</p>
    </div>
  ),
});

interface RouteNode {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
  isHub: boolean;
  isActive: boolean;
}

interface RouteEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distanceKm: number;
  roadName: string | null;
  isBidirectional: boolean;
  fromNode: { name: string; latitude: number; longitude: number };
  toNode: { name: string; latitude: number; longitude: number };
}

const PLACE_TYPES = [
  "ROUTE_NODE",
  "PROVINCE",
  "DISTRICT",
  "MUNICIPALITY",
  "RURAL_MUNICIPALITY",
  "WARD",
  "CHOWK",
  "HIGHWAY",
  "BUS_PARK",
  "JUNCTION",
  "TOWN"
];

export default function AdminRoutesPage() {
  const router = useRouter();

  // Active view tab: NODES or EDGES
  const [activeTab, setActiveTab] = useState<"NODES" | "EDGES">("NODES");
  
  // Data states
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [edges, setEdges] = useState<RouteEdge[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Searches & Selection
  const [nodeSearch, setNodeSearch] = useState("");
  const [edgeSearch, setEdgeSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Modals Open
  const [nodeFormOpen, setNodeFormOpen] = useState(false);
  const [edgeFormOpen, setEdgeFormOpen] = useState(false);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [deletingEdgeId, setDeletingEdgeId] = useState<string | null>(null);

  // Form Node States
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [nodeType, setNodeType] = useState("ROUTE_NODE");
  const [nodeLatitude, setNodeLatitude] = useState("");
  const [nodeLongitude, setNodeLongitude] = useState("");
  const [nodeIsHub, setNodeIsHub] = useState(false);
  const [nodeIsActive, setNodeIsActive] = useState(true);

  // Form Edge States
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [edgeFromNodeId, setEdgeFromNodeId] = useState("");
  const [edgeToNodeId, setEdgeToNodeId] = useState("");
  const [edgeDistanceKm, setEdgeDistanceKm] = useState("");
  const [edgeRoadName, setEdgeRoadName] = useState("");
  const [edgeIsBidirectional, setEdgeIsBidirectional] = useState(true);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchGraphData();
  }, []);

  async function fetchGraphData() {
    try {
      setLoading(true);
      const [nodesRes, edgesRes] = await Promise.all([
        fetch("/api/admin/routes/nodes?limit=1000", { credentials: "include" }),
        fetch("/api/admin/routes/edges?limit=1000", { credentials: "include" })
      ]);

      if (!nodesRes.ok || !edgesRes.ok) {
        if (nodesRes.status === 403 || edgesRes.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error("Failed to fetch graph data");
      }

      const nodesData = await nodesRes.json();
      const edgesData = await edgesRes.json();

      setNodes(nodesData.nodes || []);
      setEdges(edgesData.edges || []);
    } catch (err) {
      toast.error("Failed to load routing network graph.");
    } finally {
      setLoading(false);
    }
  }

  // NODE FORM SUBMIT
  async function handleNodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nodeName || !nodeLatitude || !nodeLongitude) {
      toast.error("Fill in name and coordinates.");
      return;
    }

    try {
      setSubmitting(true);
      const url = editingNodeId ? `/api/admin/routes/nodes/${editingNodeId}` : "/api/admin/routes/nodes";
      const method = editingNodeId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nodeName,
          type: nodeType,
          latitude: parseFloat(nodeLatitude),
          longitude: parseFloat(nodeLongitude),
          isHub: nodeIsHub,
          isActive: nodeIsActive,
        }),
        credentials: "include"
      });

      if (!res.ok) throw new Error("Could not save node");
      toast.success(editingNodeId ? "Route node updated" : "Route node created");
      setNodeFormOpen(false);
      fetchGraphData();
    } catch (err) {
      toast.error("Could not save route node.");
    } finally {
      setSubmitting(false);
    }
  }

  // EDGE FORM SUBMIT
  async function handleEdgeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!edgeFromNodeId || !edgeToNodeId) {
      toast.error("Must select start and end nodes.");
      return;
    }
    if (edgeFromNodeId === edgeToNodeId) {
      toast.error("Cannot connect a node to itself.");
      return;
    }

    try {
      setSubmitting(true);
      const url = editingEdgeId ? `/api/admin/routes/edges/${editingEdgeId}` : "/api/admin/routes/edges";
      const method = editingEdgeId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromNodeId: edgeFromNodeId,
          toNodeId: edgeToNodeId,
          distanceKm: edgeDistanceKm ? parseFloat(edgeDistanceKm) : undefined,
          roadName: edgeRoadName || null,
          isBidirectional: edgeIsBidirectional,
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Could not save edge");
      }

      toast.success(editingEdgeId ? "Route edge updated" : "Route edge established");
      setEdgeFormOpen(false);
      fetchGraphData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save route edge.");
    } finally {
      setSubmitting(false);
    }
  }

  // DELETE OPERATORS
  async function deleteNode(id: string) {
    try {
      const res = await fetch(`/api/admin/routes/nodes/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error();
      toast.success("Route node deleted");
      setDeletingNodeId(null);
      fetchGraphData();
    } catch (err) {
      toast.error("Failed to delete route node.");
    }
  }

  async function deleteEdge(id: string) {
    try {
      const res = await fetch(`/api/admin/routes/edges/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error();
      toast.success("Route edge removed");
      setDeletingEdgeId(null);
      fetchGraphData();
    } catch (err) {
      toast.error("Failed to delete route edge.");
    }
  }

  // OPEN MODAL FOR ADDING
  function openAddNode() {
    setEditingNodeId(null);
    setNodeName("");
    setNodeType("ROUTE_NODE");
    setNodeLatitude("");
    setNodeLongitude("");
    setNodeIsHub(false);
    setNodeIsActive(true);
    setNodeFormOpen(true);
  }

  function openAddEdge() {
    setEditingEdgeId(null);
    setEdgeFromNodeId(selectedNodeId || "");
    setEdgeToNodeId("");
    setEdgeDistanceKm("");
    setEdgeRoadName("");
    setEdgeIsBidirectional(true);
    setEdgeFormOpen(true);
  }

  // OPEN MODALS FOR EDITING
  function openEditNode(n: RouteNode) {
    setEditingNodeId(n.id);
    setNodeName(n.name);
    setNodeType(n.type);
    setNodeLatitude(n.latitude.toString());
    setNodeLongitude(n.longitude.toString());
    setNodeIsHub(n.isHub);
    setNodeIsActive(n.isActive);
    setNodeFormOpen(true);
  }

  function openEditEdge(e: RouteEdge) {
    setEditingEdgeId(e.id);
    setEdgeFromNodeId(e.fromNodeId);
    setEdgeToNodeId(e.toNodeId);
    setEdgeDistanceKm(e.distanceKm.toString());
    setEdgeRoadName(e.roadName || "");
    setEdgeIsBidirectional(e.isBidirectional);
    setEdgeFormOpen(true);
  }

  // FILTERED LISTS
  const filteredNodes = nodes.filter((n) =>
    n.name.toLowerCase().includes(nodeSearch.toLowerCase())
  );

  const filteredEdges = edges.filter((edge) =>
    edge.roadName?.toLowerCase().includes(edgeSearch.toLowerCase()) ||
    edge.fromNode?.name.toLowerCase().includes(edgeSearch.toLowerCase()) ||
    edge.toNode?.name.toLowerCase().includes(edgeSearch.toLowerCase())
  );

  return (
    <AppShell active="dashboard" title="Route Graph Management" subpage onBack={() => router.push("/admin")}>
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ChevronLeft size={18} className="text-slate-400" />
            <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
              Back to Admin
            </Link>
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Route Graph Management</h1>
          <p className="font-body text-slate-400 mt-1">
            Construct transit nodes and roads network for the snapped intelligent routing pipeline
          </p>
        </div>

        <div className="flex gap-2 font-body">
          <Button
            onClick={openAddNode}
            variant="outline"
            className="border-slate-800 bg-slate-900 text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            <MapPin size={16} /> Add Node
          </Button>
          <Button
            onClick={openAddEdge}
            className="bg-amber-400 text-slate-950 hover:bg-amber-500 font-semibold flex items-center gap-1.5"
          >
            <Navigation size={16} /> Connect Nodes (Edge)
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={36} />
          <p className="font-body text-slate-400">Loading Nepal Route Network Graph…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-230px)] min-h-[500px]">
          {/* Left panel: Node/Edge lists */}
          <div className="lg:col-span-1 stat-card p-4 flex flex-col h-full overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-slate-800 mb-4 font-body">
              <button
                onClick={() => setActiveTab("NODES")}
                className={`flex-1 pb-2.5 font-semibold text-sm transition-all border-b-2 ${
                  activeTab === "NODES"
                    ? "border-amber-400 text-white"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Nodes ({nodes.length})
              </button>
              <button
                onClick={() => setActiveTab("EDGES")}
                className={`flex-1 pb-2.5 font-semibold text-sm transition-all border-b-2 ${
                  activeTab === "EDGES"
                    ? "border-amber-400 text-white"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Edges ({edges.length})
              </button>
            </div>

            {/* List searches & items */}
            {activeTab === "NODES" ? (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <Input
                    placeholder="Search nodes by name…"
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                    className="pl-8 bg-slate-900 border-slate-700/50 text-white font-body text-xs"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 font-body">
                  {filteredNodes.length === 0 ? (
                    <p className="text-center text-slate-600 text-xs py-8">No nodes matching search.</p>
                  ) : (
                    filteredNodes.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => setSelectedNodeId(n.id)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                          selectedNodeId === n.id
                            ? "bg-slate-900 border-amber-400 text-white shadow-md shadow-amber-400/5"
                            : "bg-slate-900/40 border-slate-800 text-slate-300 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold flex items-center gap-1">
                              {n.isHub && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 block animate-pulse"></span>}
                              {n.name}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {n.type} &bull; {n.latitude.toFixed(4)}, {n.longitude.toFixed(4)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => openEditNode(n)}
                              className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              onClick={() => setDeletingNodeId(n.id)}
                              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <Input
                    placeholder="Search edges by road or node…"
                    value={edgeSearch}
                    onChange={(e) => setEdgeSearch(e.target.value)}
                    className="pl-8 bg-slate-900 border-slate-700/50 text-white font-body text-xs"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 font-body">
                  {filteredEdges.length === 0 ? (
                    <p className="text-center text-slate-600 text-xs py-8">No edges matching search.</p>
                  ) : (
                    filteredEdges.map((edge) => (
                      <div
                        key={edge.id}
                        className="p-2.5 rounded-lg border bg-slate-900/40 border-slate-800 text-xs text-slate-300"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold text-white">{edge.roadName || "Unnamed Segment"}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                              <span>{edge.fromNode?.name || "???"}</span>
                              <span className="text-amber-500">&harr;</span>
                              <span>{edge.toNode?.name || "???"}</span>
                            </p>
                            <p className="text-[9px] text-slate-500 mt-0.5">
                              Distance: {edge.distanceKm.toFixed(2)} km &bull; {edge.isBidirectional ? "Bidirectional" : "One-Way"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEditEdge(edge)}
                              className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              onClick={() => setDeletingEdgeId(edge.id)}
                              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Leaflet Map */}
          <div className="lg:col-span-2 h-full">
            <RouteGraphMap
              nodes={nodes.map((n) => ({ id: n.id, name: n.name, latitude: n.latitude, longitude: n.longitude, isHub: n.isHub }))}
              edges={edges}
              selectedNodeId={selectedNodeId}
              onNodeClick={(node) => {
                setSelectedNodeId(node.id);
                setActiveTab("NODES");
              }}
            />
          </div>
        </div>
      )}

      {/* NODE MODAL FORM */}
      <Dialog open={nodeFormOpen} onOpenChange={() => setNodeFormOpen(false)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <MapPin className="text-amber-400" /> {editingNodeId ? "Edit Transit Node Coordinates" : "Add Graph Routing Node"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Provide exact GPS decimal coordinates to bind paths correctly.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleNodeSubmit} className="space-y-4 pt-2 text-xs">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Node Name *</label>
              <Input
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="e.g. Pokhara Bus Junction"
                className="bg-slate-900 border-slate-700/60 text-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Place Type Category *</label>
              <select
                value={nodeType}
                onChange={(e) => setNodeType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
              >
                {PLACE_TYPES.map((type) => (
                  <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Latitude *</label>
                <Input
                  value={nodeLatitude}
                  onChange={(e) => setNodeLatitude(e.target.value)}
                  type="number"
                  step="0.000001"
                  placeholder="28.2063"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Longitude *</label>
                <Input
                  value={nodeLongitude}
                  onChange={(e) => setNodeLongitude(e.target.value)}
                  type="number"
                  step="0.000001"
                  placeholder="83.9855"
                  className="bg-slate-900 border-slate-700/60 text-white"
                  required
                />
              </div>
            </div>

            <div className="flex gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-850">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={nodeIsHub}
                  onChange={(e) => setNodeIsHub(e.target.checked)}
                  id="nh-hub"
                  className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                />
                <label htmlFor="nh-hub" className="font-semibold text-slate-300">Is Transit Hub</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={nodeIsActive}
                  onChange={(e) => setNodeIsActive(e.target.checked)}
                  id="nh-act"
                  className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
                />
                <label htmlFor="nh-act" className="font-semibold text-slate-300">Node Active</label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNodeFormOpen(false)}
                className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-amber-400 text-slate-950 font-semibold hover:bg-amber-500"
              >
                {submitting ? "Saving Node…" : editingNodeId ? "Save Changes" : "Create Node"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDGE MODAL FORM */}
      <Dialog open={edgeFormOpen} onOpenChange={() => setEdgeFormOpen(false)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Navigation className="text-amber-400" /> {editingEdgeId ? "Edit Connected Road Edge" : "Establish Road Link Edge"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Form links between two nodes. Distance can be auto-calculated using coordinate math.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEdgeSubmit} className="space-y-4 pt-2 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Start Node *</label>
                <select
                  value={edgeFromNodeId}
                  onChange={(e) => setEdgeFromNodeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
                  required
                >
                  <option value="" disabled>-- Select Node --</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">End Node *</label>
                <select
                  value={edgeToNodeId}
                  onChange={(e) => setEdgeToNodeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/60 text-white font-body text-sm focus:outline-none focus:border-amber-400/50"
                  required
                >
                  <option value="" disabled>-- Select Node --</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Road Name (Optional)</label>
              <Input
                value={edgeRoadName}
                onChange={(e) => setEdgeRoadName(e.target.value)}
                placeholder="e.g. Prithvi Highway"
                className="bg-slate-900 border-slate-700/60 text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Distance (Km) - Leave blank for GPS auto-calc
              </label>
              <Input
                value={edgeDistanceKm}
                onChange={(e) => setEdgeDistanceKm(e.target.value)}
                type="number"
                step="0.01"
                placeholder="Auto-calculated from coordinates..."
                className="bg-slate-900 border-slate-700/60 text-white"
              />
            </div>

            <div className="flex gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-850">
              <input
                type="checkbox"
                checked={edgeIsBidirectional}
                onChange={(e) => setEdgeIsBidirectional(e.target.checked)}
                id="edg-bi"
                className="w-4 h-4 rounded border-slate-700 text-amber-500 accent-amber-500"
              />
              <label htmlFor="edg-bi" className="font-semibold text-slate-300">Bidirectional Road connection</label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEdgeFormOpen(false)}
                className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-amber-400 text-slate-950 font-semibold hover:bg-amber-500"
              >
                {submitting ? "Establishing Link…" : editingEdgeId ? "Save Changes" : "Create Road Link"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATIONS */}
      <Dialog open={deletingNodeId !== null} onOpenChange={() => setDeletingNodeId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Delete Routing Node?</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Are you sure you want to delete this route node? All connected road edges will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeletingNodeId(null)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deletingNodeId && deleteNode(deletingNodeId)}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              Yes, Delete Node
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingEdgeId !== null} onOpenChange={() => setDeletingEdgeId(null)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-white rounded-xl font-body">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Remove Road Edge Link?</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Are you sure you want to remove this road edge connecting the nodes? This is irreversible.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeletingEdgeId(null)}
              className="border-slate-850 bg-slate-900 text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deletingEdgeId && deleteEdge(deletingEdgeId)}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              Remove Edge Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
