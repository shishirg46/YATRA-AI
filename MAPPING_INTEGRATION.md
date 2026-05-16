# Mapping Integration Guide

## Overview
YatraAI now includes an interactive route mapping system powered by Leaflet and OpenRouteService API for better route visualization and segment analysis.

## What's New

### 1. **Interactive Route Maps**
- Visual display of complete routes on OpenStreetMap
- Color-coded segments based on risk levels (Low → Green, Medium → Amber, High → Orange, Extreme → Red)
- Waypoint markers for start/end points and intermediate stops
- Responsive design that works on all devices

### 2. **Route Geometry API**
Endpoint: `POST /api/routes/geometry`

**Request:**
```json
{
  "startLat": 27.7,
  "startLon": 85.3,
  "endLat": 28.2,
  "endLon": 85.9,
  "profile": "driving-car"
}
```

**Response:**
```json
{
  "waypoints": [...],
  "segments": [...],
  "distance": 150000,
  "duration": 7200,
  "geometry": "encoded_polyline_string"
}
```

### 3. **Segment Details**
Interactive popups show:
- Distance for each segment
- Risk level (Low/Medium/High/Extreme)
- Associated hazards (floods, landslides, etc.)
- Weather conditions (temperature, rainfall)
- Recommendations for travel

### 4. **Components**

#### `<RouteMapLoader />`
Async wrapper that fetches route geometry and displays the map.

**Usage:**
```tsx
import RouteMapLoader from "@/components/route-map-loader";

export default function TripMap() {
  return (
    <RouteMapLoader
      startLat={27.7}
      startLon={85.3}
      endLat={28.2}
      endLon={85.9}
      originName="Kathmandu"
      destinationName="Namche Bazaar"
      riskLevel="MEDIUM"
    />
  );
}
```

#### `<RouteMap />`
Core map component with Leaflet integration.

**Props:**
- `waypoints`: Array of {lat, lon, name?}
- `segments?`: Array of segment info with risk details
- `originName?`: Name of start point
- `destinationName?`: Name of end point
- `distance?`: Total distance in meters
- `duration?`: Total duration in seconds
- `riskLevel?`: Overall risk level
- `onSegmentClick?`: Callback when segment is clicked
- `height?`: Custom CSS height (default: "h-96")

#### `<SegmentDetails />`
Modal for displaying detailed segment information.

**Features:**
- Risk assessment
- Weather conditions
- Hazards list
- Location coordinates
- Travel recommendations

## Environment Variables

Required additions to `.env` and `.env.local`:

```env
# OpenRouteService API (for routing)
OPENROUTESERVICE_API_KEY="your_api_key_here"

# Map provider (free, no key needed)
NEXT_PUBLIC_MAP_PROVIDER="openstreetmap"
```

## Installation

Packages installed:
- `leaflet` - Core mapping library
- `react-leaflet` - React bindings for Leaflet
- `leaflet-routing-machine` - For advanced routing features
- `@types/leaflet` - TypeScript definitions
- `@types/leaflet-routing-machine` - TypeScript definitions

Run: `npm install` to install all dependencies

## Integration Examples

### In Trip Detail Page

```tsx
import RouteMapLoader from "@/components/route-map-loader";

// Inside trip detail component
<div className="trip-card rounded-2xl p-6">
  <h2 className="font-display font-bold text-white mb-4">Route Map</h2>
  <RouteMapLoader
    startLat={plan.stops[0].location.lat}
    startLon={plan.stops[0].location.lon}
    endLat={plan.stops[plan.stops.length - 1].location.lat}
    endLon={plan.stops[plan.stops.length - 1].location.lon}
    originName={plan.stops[0].location.name}
    destinationName={plan.stops[plan.stops.length - 1].location.name}
    riskLevel={risk?.overallGroupLevel || "MEDIUM"}
  />
</div>
```

### In Plan Creation

```tsx
import RouteMapLoader from "@/components/route-map-loader";

// Show route preview while planning
{destination && originLat && originLon && (
  <RouteMapLoader
    startLat={originLat}
    startLon={originLon}
    endLat={destination.latitude}
    endLon={destination.longitude}
    destinationName={destination.name}
  />
)}
```

## Styling

All map styling is configured in `app/globals.css`:
- Dark theme matching app design
- Custom controls and popups
- Responsive tile layer brightness
- Legend colors for risk levels

## Features Roadmap

- [ ] Multiple route alternatives (fastest, safest, scenic)
- [ ] Real-time hazard overlay integration
- [ ] Historical event markers
- [ ] Weather overlay
- [ ] Offline map support
- [ ] Route export (PDF, GeoJSON)
- [ ] Real-time member location tracking (with permission)
- [ ] Emergency contact markers

## Troubleshooting

### Map not rendering
- Ensure `dynamic = "force-dynamic"` is set in API routes
- Check browser console for CORS or API key errors
- Verify OpenStreetMap tiles are accessible

### Segments not showing
- Check that segment data is returned from API
- Verify coordinates are within Nepal bounds
- Check for console errors in browser DevTools

### Missing tiles
- Verify internet connection
- Check OpenStreetMap service status
- Try clearing browser cache

## References

- [Leaflet Documentation](https://leafletjs.com/)
- [React-Leaflet Documentation](https://react-leaflet.js.org/)
- [OpenRouteService API](https://openrouteservice.org/)
- [OpenStreetMap](https://www.openstreetmap.org/)
