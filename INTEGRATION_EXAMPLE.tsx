/**
 * FILE: INTEGRATION_EXAMPLE.tsx
 * LOCATION: Reference example for integrating maps into trip pages
 * PURPOSE: Show practical examples of how to use the new mapping components
 */

// ── Example 1: Simple Route Map in Trip Detail ──────────────────────────────

/*
In /app/trips/[id]/page.tsx, add this after the hero card:

import RouteMapLoader from "@/components/route-map-loader";

// Inside the JSX render:
{plan.stops.length >= 2 && (
  <div className="trip-card rounded-2xl p-6 anim">
    <div className="flex items-center gap-2 mb-4">
      <MapPin size={16} className="text-amber-400"/>
      <h3 className="font-display font-bold text-white">Route Map</h3>
    </div>
    <RouteMapLoader
      startLat={plan.stops[0].location.latitude ?? 27.7}
      startLon={plan.stops[0].location.longitude ?? 85.3}
      endLat={plan.stops[plan.stops.length - 1].location.latitude ?? 28.2}
      endLon={plan.stops[plan.stops.length - 1].location.longitude ?? 85.9}
      originName={plan.stops[0].location.name}
      destinationName={plan.stops[plan.stops.length - 1].location.name}
      riskLevel={risk?.overallGroupLevel || "MEDIUM"}
      height="h-[500px]"
    />
  </div>
)}
*/

// ── Example 2: Route Preview in Plan Creation ──────────────────────────────

/*
In /app/plan/page.tsx, add this when destination and origin are selected:

import RouteMapLoader from "@/components/route-map-loader";

// Inside the form:
{destination && originLat && originLon && travelDate && (
  <div className="plan-card rounded-xl p-4 border border-slate-700/50">
    <div className="mb-3 flex items-center gap-2">
      <MapPin size={14} className="text-amber-400"/>
      <h4 className="font-body text-sm font-semibold text-white">Your Route Preview</h4>
    </div>
    <RouteMapLoader
      startLat={originLat}
      startLon={originLon}
      endLat={destination.latitude ?? 28.2}
      endLon={destination.longitude ?? 85.9}
      originName="Your Location"
      destinationName={destination.name}
      riskLevel="MEDIUM"
      height="h-[300px]"
    />
  </div>
)}
*/

// ── Example 3: Multi-Stop Route Map ────────────────────────────────────────

/*
For trips with multiple stops, create a custom wrapper:

import RouteMapLoader from "@/components/route-map-loader";
import RouteMap from "@/components/route-map";
import { calculateBounds, toLatLng } from "@/lib/map-utils";

function MultiStopRouteMap({ stops, riskLevel }) {
  const allWaypoints = stops.map(stop => ({
    lat: stop.location.latitude ?? 27.7,
    lon: stop.location.longitude ?? 85.3,
    name: stop.location.name,
  }));

  return (
    <RouteMap
      waypoints={allWaypoints}
      originName={stops[0].location.name}
      destinationName={stops[stops.length - 1].location.name}
      riskLevel={riskLevel}
      height="h-[400px]"
    />
  );
}

// Usage:
<MultiStopRouteMap stops={plan.stops} riskLevel={risk?.overallGroupLevel} />
*/

// ── Example 4: Real-time Route Checking ────────────────────────────────────

/*
Integrate with route checking API:

import RouteMapLoader from "@/components/route-map-loader";

async function checkRouteAndDisplay(originLat, originLon, destLat, destLon) {
  // Fetch route geometry
  const geomRes = await fetch("/api/routes/geometry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startLat: originLat,
      startLon: originLon,
      endLat: destLat,
      endLon: destLon,
    }),
  });
  
  // Fetch route risk assessment
  const riskRes = await fetch("/api/routes/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: { lat: originLat, lon: originLon },
      destination: { lat: destLat, lon: destLon },
      travelDate: new Date().toISOString().split("T")[0],
    }),
  });

  const [geom, risk] = await Promise.all([geomRes.json(), riskRes.json()]);
  
  return { geometry: geom, risk };
}
*/

// ── Example 5: Emergency Route Display ─────────────────────────────────────

/*
Show evacuation or emergency routes:

import RouteMap from "@/components/route-map";
import { getRiskColor } from "@/lib/map-utils";

function EmergencyRouteView({ currentLat, currentLon, shelterLat, shelterLon }) {
  const waypoints = [
    { lat: currentLat, lon: currentLon, name: "Current Location" },
    { lat: shelterLat, lon: shelterLon, name: "Emergency Shelter" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="w-full max-w-2xl max-h-[80vh] rounded-lg overflow-hidden">
        <RouteMap
          waypoints={waypoints}
          originName="Current Location"
          destinationName="Emergency Shelter"
          riskLevel="EXTREME"
          height="h-[500px]"
        />
      </div>
    </div>
  );
}
*/

// ── Usage Notes ─────────────────────────────────────────────────────────────

/*
IMPORTANT POINTS:

1. LOCATION DATA STRUCTURE
   - Make sure location objects have 'latitude' and 'longitude' properties
   - If they use 'lat' and 'lon' instead, update the refs accordingly
   - Fallback coordinates are provided (Nepal center: 27.7, 85.3)

2. ASYNC LOADING
   - RouteMapLoader handles API calls automatically
   - Shows loading spinner while fetching
   - Falls back to simple route if API fails

3. PERFORMANCE
   - Lazy load map component (use React.lazy() if needed)
   - Map renders at full height - adjust 'height' prop for responsive design
   - Segment count auto-calculated (max 5 by default)

4. STYLING
   - All map styling in app/globals.css
   - Dark theme matches YatraAI design
   - Responsive to viewport size

5. ERROR HANDLING
   - API errors show user-friendly warning
   - Fallback to simple line-between-points if API fails
   - Always renders map even on partial data loss

6. ACCESSIBILITY
   - Map is fully keyboard navigable
   - Zoom controls available
   - Popups have close buttons
   - Contrast meets WCAG standards

NEXT STEPS AFTER INTEGRATION:

1. Run: npm install
2. Restart dev server (npm run dev)
3. Add RouteMapLoader to one trip page first
4. Test with real trip data
5. Gradually add to more pages
6. Collect feedback and iterate
*/

export {};
