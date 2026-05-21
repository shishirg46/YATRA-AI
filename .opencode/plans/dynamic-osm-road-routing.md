# Implementation: Dynamic OSM Road Routing with Per-Segment Alternatives

## Files to Create

### 1. `lib/routing/osm-road-fetcher.ts` (NEW)

```typescript
import { haversineKm } from "@/lib/routing/geo";
import type { RouteNode } from "@/lib/routing/types";

const OVERPASS_URL = "https://overpass.openstreetmap.fr/api/interpreter";

function corridorBbox(
  originLat: number, originLon: number,
  destLat: number, destLon: number,
  paddingKm: number = 10
): { south: number; west: number; north: number; east: number } {
  const kmPerDegLat = 111;
  const avgLat = (originLat + destLat) / 2;
  const kmPerDegLon = 111 * Math.cos((avgLat * Math.PI) / 180);
  const padLat = paddingKm / kmPerDegLat;
  const padLon = paddingKm / kmPerDegLon;
  return {
    south: Math.min(originLat, destLat) - padLat,
    west: Math.min(originLon, destLon) - padLon,
    north: Math.max(originLat, destLat) + padLat,
    east: Math.max(originLon, destLon) + padLon,
  };
}

function bboxStr(b: { south: number; west: number; north: number; east: number }): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: (OverpassNode | OverpassWay)[];
}

export async function fetchOsmRoadNodesBetween(
  originLat: number, originLon: number,
  destLat: number, destLon: number,
  maxNodes: number = 8
): Promise<RouteNode[]> {
  const bbox = corridorBbox(originLat, originLon, destLat, destLon);
  const bb = bboxStr(bbox);
  const totalKm = haversineKm(originLat, originLon, destLat, destLon);

  const query = `[out:json][timeout:25];
(
  way["highway"~"^(primary|secondary|tertiary|trunk)$"](${bb});
  node(w);
);
out skel ${maxNodes * 20};`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": "YatraAI/1.0 (route-fetcher)",
      },
      body: query,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as OverpassResponse;
    const elements = data.elements || [];

    const wayNodeIds = new Set<number>();
    const nodeMap = new Map<number, OverpassNode>();

    for (const el of elements) {
      if (el.type === "way") {
        for (const nid of el.nodes) wayNodeIds.add(nid);
      } else if (el.type === "node" && wayNodeIds.has(el.id)) {
        nodeMap.set(el.id, el);
      }
    }

    const candidates: { node: OverpassNode; distanceToLine: number; progress: number }[] = [];

    for (const node of nodeMap.values()) {
      const progress = haversineKm(originLat, originLon, node.lat, node.lon) / Math.max(totalKm, 1);
      if (progress <= 0.05 || progress >= 0.95) continue;

      const dToLine = distanceToLineKm(
        node.lat, node.lon,
        originLat, originLon,
        destLat, destLon
      );
      if (dToLine > 15) continue;

      candidates.push({ node, distanceToLine: dToLine, progress });
    }

    candidates.sort((a, b) => a.progress - b.progress);

    const selected: RouteNode[] = [];
    const minSpacing = Math.max(15, totalKm * 0.08);
    let lastProgress = 0;

    for (const c of candidates) {
      if (selected.length >= maxNodes) break;
      const spacing = (c.progress - lastProgress) * totalKm;
      if (selected.length > 0 && spacing < minSpacing) continue;
      if (c.distanceToLine > 8) continue;

      const name = c.node.tags?.name
        || `Junction ${c.node.lat.toFixed(3)},${c.node.lon.toFixed(3)}`;

      selected.push({
        lat: c.node.lat,
        lon: c.node.lon,
        name,
        locationId: null,
        routeNodeId: `osm/${c.node.id}`,
      });
      lastProgress = c.progress;
    }

    return selected;
  } catch {
    return [];
  }
}

function distanceToLineKm(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number
): number {
  const dAB = haversineKm(aLat, aLon, bLat, bLon);
  if (dAB < 0.01) return haversineKm(pLat, pLon, aLat, aLon);
  const dAP = haversineKm(aLat, aLon, pLat, pLon);
  const dBP = haversineKm(bLat, bLon, pLat, pLon);
  const cosA = (dAP * dAP + dAB * dAB - dBP * dBP) / (2 * Math.max(dAP, 0.001) * Math.max(dAB, 0.001));
  const t = Math.max(0, Math.min(1, cosA));
  const projDist = t * dAB;
  return Math.sqrt(Math.max(0, dAP * dAP - projDist * projDist));
}
```

---

## Files to Modify

### 2. `lib/routing/types.ts`

**Add before `BuiltRoute`:**

```typescript
export interface PerSegmentRoute {
  from: RouteNode;
  to: RouteNode;
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
  alternatives: Array<{
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
    instructions: RouteInstruction[];
  }>;
}
```

**Add `segmentRoutes` to `BuiltRoute`:**

```typescript
export interface BuiltRoute {
  // ... existing fields ...
  segmentRoutes?: PerSegmentRoute[];
  // ... rest unchanged ...
}
```

**Add new fields to `BuildRouteInput`:**

```typescript
export interface BuildRouteInput {
  // ... existing fields ...
  waypoints?: RouteNode[];
  perSegmentRouting?: boolean;
  dynamicOsmRouting?: boolean;
}
```

### 3. `lib/routing/osrm-client.ts`

**Add after `fetchOsrmLeg`:**

```typescript
export async function fetchOsrmRoutePerLeg(
  nodes: RouteNode[]
): Promise<Array<{
  from: RouteNode;
  to: RouteNode;
  routes: OsrmRouteResult[] | null;
}>> {
  if (nodes.length < 2) return [];

  const results: Array<{
    from: RouteNode;
    to: RouteNode;
    routes: OsrmRouteResult[] | null;
  }> = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const routes = await fetchOsrmRouteThroughNodes([from, to], true);
    results.push({ from, to, routes });
  }

  return results;
}
```

### 4. `lib/routing/waypoint-builder.ts`

**Add import at top:**

```typescript
import { fetchOsmRoadNodesBetween } from "@/lib/routing/osm-road-fetcher";
```

**Replace `buildIntermediateNodes` function:**

```typescript
export async function buildIntermediateNodes(
  origin: ResolvedPlace,
  destination: ResolvedPlace,
  originRouteNodeId?: string | null,
  destRouteNodeId?: string | null,
  dynamicOsmRouting: boolean = false
): Promise<{ nodes: RouteNode[]; source: string }> {
  if (origin.id && destination.id) {
    const template = await loadTemplateNodes(origin.id, destination.id);
    if (template && template.length >= 2) {
      const trimmed = trimIntermediateStops(template, origin, destination);
      if (trimmed.length > 0) {
        return { nodes: trimmed, source: "template" };
      }
    }
  }

  const graph = await buildGraphWaypoints(
    origin.lat,
    origin.lon,
    destination.lat,
    destination.lon,
    originRouteNodeId,
    destRouteNodeId
  );
  if (graph.nodes.length > 0) {
    return graph;
  }

  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  if (totalKm <= 30) {
    return { nodes: [], source: "short-direct" };
  }

  const originHub = await findNearestRouteNode(origin.lat, origin.lon, 35);
  const destHub = await findNearestRouteNode(destination.lat, destination.lon, 45);
  if (originHub && destHub && originHub.id !== destHub.id) {
    const retry = await buildGraphWaypoints(
      originHub.lat,
      originHub.lon,
      destHub.lat,
      destHub.lon,
      originHub.id,
      destHub.id
    );
    if (retry.nodes.length > 0) return retry;
  }

  if (dynamicOsmRouting && totalKm > 30) {
    const osmNodes = await fetchOsmRoadNodesBetween(
      origin.lat, origin.lon,
      destination.lat, destination.lon
    );
    if (osmNodes.length > 0) {
      return { nodes: osmNodes, source: "osm-road" };
    }
  }

  return { nodes: [], source: "direct" };
}
```

### 5. `lib/routing/route-service.ts`

**Add imports at top:**

```typescript
import { fetchOsrmRouteThroughNodes, fetchOsrmRoutePerLeg } from "@/lib/routing/osrm-client";
```

**Add new function after `applyOsrmToChain`:**

```typescript
async function applyPerSegmentRouting(
  chain: RouteNode[]
): Promise<{
  segmentRoutes: PerSegmentRoute[];
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
}> {
  const legs = await fetchOsrmRoutePerLeg(chain);
  const segmentRoutes: PerSegmentRoute[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  const fullPolyline: Array<{ lat: number; lon: number }> = [];
  const allInstructions: RouteInstruction[] = [];

  for (const leg of legs) {
    const primary = leg.routes?.[0];
    const alternatives = (leg.routes?.slice(1) || []).map((alt) => ({
      polyline: alt.coordinates,
      distance: alt.distance,
      duration: alt.duration,
      instructions: alt.instructions || [],
    }));

    if (primary) {
      totalDistance += primary.distance;
      totalDuration += primary.duration;
      fullPolyline.push(...primary.coordinates);
      if (primary.instructions) allInstructions.push(...primary.instructions);
    }

    segmentRoutes.push({
      from: leg.from,
      to: leg.to,
      polyline: primary?.coordinates || fallbackPolyline([leg.from, leg.to]),
      distance: primary?.distance || Math.round(haversineKm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon) * 1000),
      duration: primary?.duration || 0,
      instructions: primary?.instructions,
      alternatives,
    });
  }

  return {
    segmentRoutes,
    polyline: fullPolyline,
    distance: totalDistance,
    duration: totalDuration,
    instructions: allInstructions.length > 0 ? allInstructions : undefined,
  };
}
```

**Update `buildSegmentedRoute` to accept new params and add per-segment logic:**

Replace the `async function buildSegmentedRoute(input: BuildRouteInput): Promise<BuiltRoute>` with:

```typescript
export async function buildSegmentedRoute(input: BuildRouteInput): Promise<BuiltRoute> {
  if (!isPointInNepal(input.originLat, input.originLon)) {
    throw new Error("Origin is outside Nepal. This service is only available for locations within Nepal.");
  }
  if (input.destinationLat !== undefined && input.destinationLon !== undefined && !isPointInNepal(input.destinationLat, input.destinationLon)) {
    throw new Error("Destination is outside Nepal. This service is only available for locations within Nepal.");
  }

  const { place: originResolved, note: originNote, routeNodeId: originNodeId } = await resolveOrigin(
    input.originLat,
    input.originLon,
    input.originName,
    input.originRouteNodeId
  );

  const origin: ResolvedPlace = {
    ...originResolved,
    displayLat: input.originDisplayLat ?? originResolved.displayLat ?? originResolved.lat,
    displayLon: input.originDisplayLon ?? originResolved.displayLon ?? originResolved.lon,
  };

  const { place: destinationResolved, note: destNote } = await resolveDestination({
    destinationId: input.destinationId,
    destinationName: input.destinationName,
    destinationLat: input.destinationLat,
    destinationLon: input.destinationLon,
  });

  const destination: ResolvedPlace = {
    ...destinationResolved,
    displayLat: input.destinationDisplayLat ?? destinationResolved.lat,
    displayLon: input.destinationDisplayLon ?? destinationResolved.lon,
  };

  // Use explicit waypoints if provided
  if (input.waypoints && input.waypoints.length > 0) {
    const chain = assembleNodeChain(origin, input.waypoints, destination);
    const source = "user-waypoints";

    let segmentRoutes: PerSegmentRoute[] | undefined;
    let polyline: Array<{ lat: number; lon: number }>;
    let distance: number;
    let duration: number;
    let instructions: RouteInstruction[] | undefined;
    let alternatives: BuiltRoute["alternatives"];

    if (input.perSegmentRouting) {
      const perSeg = await applyPerSegmentRouting(chain);
      segmentRoutes = perSeg.segmentRoutes;
      polyline = perSeg.polyline;
      distance = perSeg.distance;
      duration = perSeg.duration;
      instructions = perSeg.instructions;
      alternatives = undefined;
    } else {
      const osrm = await applyOsrmToChain(chain, source);
      polyline = osrm.polyline;
      distance = osrm.distance;
      duration = osrm.duration;
      instructions = osrm.instructions;
      alternatives = osrm.alternatives;
    }

    const segments = buildSegmentsFromNodes(chain);

    const displayWaypoints = chain.map((n, order) => ({
      lat: n.lat, lon: n.lon, name: n.name, order,
    }));
    if (displayWaypoints.length > 0) {
      displayWaypoints[0] = { ...displayWaypoints[0], lat: origin.displayLat ?? origin.lat, lon: origin.displayLon ?? origin.lon, name: origin.name };
      const last = displayWaypoints.length - 1;
      displayWaypoints[last] = { ...displayWaypoints[last], lat: destination.displayLat ?? destination.lat, lon: destination.displayLon ?? destination.lon, name: destination.name };
    }

    return {
      origin, destination,
      nodes: chain,
      waypoints: displayWaypoints,
      segments, polyline, distance, duration,
      instructions, alternatives,
      segmentRoutes,
      source,
      resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
    };
  }

  // Standard flow: auto-generate intermediates
  const destHub = await findNearestRouteNodeFromCoords(destination.lat, destination.lon);
  const { nodes: intermediates, source: nodeSource } = await buildIntermediateNodes(
    origin,
    destination,
    originNodeId ?? input.originRouteNodeId,
    input.destinationRouteNodeId ?? destHub?.id,
    input.dynamicOsmRouting
  );

  let chain = assembleNodeChain(origin, intermediates, destination);
  let source = nodeSource;

  const expanded = await ensureMultiStopChain(origin, destination, chain, source);
  chain = expanded.chain;
  source = expanded.source;

  let segmentRoutes: PerSegmentRoute[] | undefined;
  let polyline: Array<{ lat: number; lon: number }>;
  let distance: number;
  let duration: number;
  let instructions: RouteInstruction[] | undefined;
  let alternatives: BuiltRoute["alternatives"];

  if (input.perSegmentRouting) {
    const perSeg = await applyPerSegmentRouting(chain);
    segmentRoutes = perSeg.segmentRoutes;
    ({ polyline, distance, duration, instructions } = perSeg);
    alternatives = undefined;
  } else {
    const osrm = await applyOsrmToChain(chain, source);
    ({ polyline, distance, duration, instructions, alternatives } = osrm);
  }

  const segments = buildSegmentsFromNodes(chain);

  const displayWaypoints = chain.map((n, order) => ({
    lat: n.lat, lon: n.lon, name: n.name, order,
  }));
  if (displayWaypoints.length > 0) {
    displayWaypoints[0] = {
      ...displayWaypoints[0],
      lat: origin.displayLat ?? origin.lat,
      lon: origin.displayLon ?? origin.lon,
      name: origin.name,
    };
    const last = displayWaypoints.length - 1;
    displayWaypoints[last] = {
      ...displayWaypoints[last],
      lat: destination.displayLat ?? destination.lat,
      lon: destination.displayLon ?? destination.lon,
      name: destination.name,
    };
  }

  return {
    origin,
    destination,
    nodes: chain,
    waypoints: displayWaypoints,
    segments,
    polyline,
    distance,
    duration,
    instructions,
    alternatives,
    segmentRoutes,
    source: routingSource,
    resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
  };
}
```

**Update `toMapPayload` to include segmentRoutes:**

Add after the alternatives mapping:
```typescript
segmentRoutes: built.segmentRoutes?.map((sr) => ({
  from: sr.from,
  to: sr.to,
  polyline: prepareMapPolyline(filterNepalPolyline(sr.polyline), { maxPoints: 60 }),
  distance: sr.distance,
  duration: sr.duration,
  instructions: capInstructions(sr.instructions),
  alternatives: sr.alternatives.map((alt) => ({
    ...alt,
    polyline: prepareMapPolyline(filterNepalPolyline(alt.polyline), { maxPoints: 60 }),
    instructions: capInstructions(alt.instructions) ?? [],
  })),
})),
```

### 6. `app/api/routes/geometry/route.ts`

**Update the body destructuring to include new params:**

```typescript
const {
  startLat, startLon, endLat, endLon,
  destinationId, destinationName, originName,
  accuracy, originRouteNodeId,
  useResolvedOrigin = true,
  originAlreadyResolved = false,
  displayStartLat, displayStartLon,
  waypoints,           // NEW
  perSegmentRouting,   // NEW
  dynamicOsmRouting,   // NEW
} = body;
```

**Update the `buildSegmentedRoute` call to pass new params:**

```typescript
const built = await buildSegmentedRoute({
  originLat, originLon,
  originDisplayLat, originDisplayLon,
  originName: resolvedOriginName,
  originRouteNodeId: resolvedNodeId,
  destinationLat: endLat, destinationLon: endLon,
  destinationId: typeof destinationId === "string" ? destinationId : undefined,
  destinationName: typeof destinationName === "string" ? destinationName : undefined,
  waypoints: waypoints || undefined,
  perSegmentRouting: perSegmentRouting === true,
  dynamicOsmRouting: dynamicOsmRouting === true,
});
```

### 7. `components/route-map-loader.tsx`

**Update the fetch body to include new params:**

In the `fetch("/api/routes/geometry", {...})` call, add to `body`:
```typescript
body: JSON.stringify({
  // ... existing fields ...
  waypoints: undefined,  // set when provided
  perSegmentRouting: true,
  dynamicOsmRouting: true,
}),
```

**Add state for segmentRoutes:**
```typescript
const [segmentRoutes, setSegmentRoutes] = useState<Array<{
  from: any; to: any; polyline: any[];
  distance: number; duration: number;
  instructions?: any[];
  alternatives: any[];
}>>([]);
```

**After `setInstructions`, add:**
```typescript
setSegmentRoutes(data.segmentRoutes || []);
```

**Pass `segmentRoutes` to `RouteMap`.**

### 8. `components/route-map.tsx`

**Add `segmentRoutes` prop to `RouteMapProps`:**
```typescript
segmentRoutes?: Array<{
  from: any; to: any; polyline: Array<{ lat: number; lon: number }>;
  distance: number; duration: number;
  instructions?: any[];
  alternatives: Array<{ polyline: Array<{ lat: number; lon: number }>; distance: number; duration: number; instructions: any[] }>;
}>;
```

**Add per-segment route rendering after alternatives block:**
```typescript
{segmentRoutes?.map((sr, segIdx) => (
  <div key={`seg-alt-${segIdx}`} style={{ display: 'none' }}>
    {/* Each segment's alternatives rendered as thin lines */}
    {sr.alternatives.map((alt, altIdx) => (
      <RoutePolyline
        key={`seg-${segIdx}-alt-${altIdx}`}
        waypoints={alt.polyline}
        riskLevel="MEDIUM"
        isAlternative={true}
        isActive={false}
      />
    ))}
  </div>
))}
```

---

## Implementation Order

1. Create `lib/routing/osm-road-fetcher.ts`
2. Edit `lib/routing/types.ts` — add PerSegmentRoute, update BuiltRoute, update BuildRouteInput
3. Edit `lib/routing/osrm-client.ts` — add fetchOsrmRoutePerLeg
4. Edit `lib/routing/waypoint-builder.ts` — update buildIntermediateNodes with OSM fallback
5. Edit `lib/routing/route-service.ts` — add applyPerSegmentRouting, update buildSegmentedRoute, update toMapPayload
6. Edit `app/api/routes/geometry/route.ts` — accept new params
7. Edit `components/route-map-loader.tsx` — handle segmentRoutes response
8. Edit `components/route-map.tsx` — render segment routes
9. Run `npm run typecheck` and `npm run lint` to verify

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Overpass `around` corridor | Uses bounding box + distance-to-line filtering to find road nodes along the route axis without hitting OSM rate limits |
| Per-segment OSRM calls | Independent calls for each leg gives full alternatives per segment, avoiding OSRM's single `alternatives` for the whole chain |
| Max 8 OSM waypoints | Prevents OSRM URL length limits and keeps response size manageable |
| `dynamicOsmRouting` flag | Opt-in so simple routes don't incur extra Overpass API calls |
| OSM nodes as `RouteNode` | Uses existing type system — OSM-derived nodes get `routeNodeId: "osm/<id>"` for traceability |

## Verification

After implementing, run:
```bash
npm run typecheck
npm run lint
```
