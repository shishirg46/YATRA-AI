# Graph Specification

Canonical reference for the Yatra road intelligence graph architecture.

---

## 1. Layer Architecture

```
OSM Import (01-import-osm-pbf.ts)
    │
    ▼
RouteNode (02-build-route-graph.ts)
    │
    ├──────────────────┐
    ▼                  ▼
RouteSegment       EdgeCache
(02b-build-route-  (03-build-edge-
 segments.ts)       cache.ts)
    │
    ▼
Hazard            ─── independent spatial geometries
(06-ingest-hazards.ts)   (POINT / LINESTRING / POLYGON)
    │
    ▼
segment_hazard    ─── derived: ST_Intersects(hazard.geometry,
(07-precompute-              route_segment.geometry)
 segment-hazards.ts)
    │
    ▼
Planner / AI (future)
```

### Layer responsibilities

| Layer | Responsibility | Rebuild? |
|-------|---------------|----------|
| `osm_node` | Raw OSM node coordinates (BIGINT PK) | Per import |
| `_way_nodes` | Staging: way→node→position mapping | Per import, dropped on publish |
| `osm_way` | OSM way metadata + tags | Per import |
| `route_node` | Canonical graph node (every OSM node on a highway way) | Per build |
| `intersection` | Detected junction nodes (degree ≥ 2) | Per build |
| **`route_segment`** | Canonical semantic road piece | Per build |
| `edge_cache` | Consecutive pair edges for routing | Per build |
| `graph_build` | Build metadata + state machine | Per build |
| `graph_config` | Active version pointer | Updated on publish |

### Hazard layers

| Layer | Responsibility | Rebuild? |
|-------|---------------|----------|
| **`hazard`** | Independent spatial hazard geometry (POINT/LINESTRING/POLYGON) | Independent |
| **`segment_hazard`** | Precomputed hazard↔segment intersections via `ST_Intersects` | After hazard or segment change |

---

## 2. State Machine

```
BUILDING ──► READY ──► VALIDATING ──► ACTIVE
                 ▲                       │
                 │                       │
                 └─────── FAILED ◄───────┘
```

- `BUILDING`: Import or graph build in progress
- `READY`: Build complete, awaiting validation
- `VALIDATING`: Validation in progress
- `ACTIVE`: Published (validation passed, `_way_nodes` dropped)
- `FAILED`: Validation or build failed

### Pipeline stages

```
import:osm ──► build:route-graph ──► build:route-segments ──► build:edge-cache ──► validate:build ──► publish:graph
```

Each stage is independently runnable via npm scripts.

---

## 3. RouteSegment Schema

```sql
CREATE TABLE route_segment (
  id                  TEXT PRIMARY KEY,
  osm_way_id          TEXT NOT NULL,
  segment_index       INT NOT NULL,
  from_node_id        TEXT NOT NULL REFERENCES route_node(id),
  to_node_id          TEXT NOT NULL REFERENCES route_node(id),

  geometry            GEOMETRY(LineString, 4326) NOT NULL,
  geometry_hash       TEXT NOT NULL,            -- md5(ST_AsEWKB(ST_Force2D(geometry)))
  length_m            DOUBLE PRECISION NOT NULL,
  start_bearing       DOUBLE PRECISION,         -- NULL if length_m ≤ 1.0
  end_bearing         DOUBLE PRECISION,         -- NULL if length_m ≤ 1.0
  curvature_deg       DOUBLE PRECISION,         -- NULL for 2-point segments

  osm_node_ids        BIGINT[] NOT NULL,
  from_sequence_index INT NOT NULL,
  to_sequence_index   INT NOT NULL,
  intermediate_count  INT NOT NULL DEFAULT 0,
  vertex_count        INT NOT NULL DEFAULT 2,

  -- First-class OSM tag columns (commonly queried)
  highway             TEXT,
  surface             TEXT,
  tracktype           TEXT,
  smoothness          TEXT,
  lanes               INT,
  width               DOUBLE PRECISION,
  maxspeed            INT,
  bridge              TEXT,
  tunnel              TEXT,
  ford                TEXT,
  access              TEXT,
  oneway              BOOLEAN DEFAULT false,
  name                TEXT,
  ref                 TEXT,
  layer               INT,
  service             TEXT,
  junction            TEXT,

  -- Catch-all for unpromoted OSM tags
  extra_tags          JSONB,

  graph_version       TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (from_node_id, to_node_id, osm_way_id, graph_version),

  CONSTRAINT chk_positive_length CHECK (length_m > 0),
  CONSTRAINT chk_min_vertices  CHECK (vertex_count >= 2),
  CONSTRAINT chk_forward_seq   CHECK (to_sequence_index > from_sequence_index),
  CONSTRAINT chk_intermediates CHECK (intermediate_count >= 0)
);
```

### Indexes

```sql
CREATE INDEX idx_rs_gv   ON route_segment (graph_version);
CREATE INDEX idx_rs_way  ON route_segment (osm_way_id);
CREATE INDEX idx_rs_geom ON route_segment USING GIST (geometry);
```

### Deterministic ID derivation

```
id = md5(graph_version || '|' || osm_way_id || '|' || from_node_id || '|' || to_node_id || '|' || segment_index)
```

- Produces identical IDs across identical inputs (deterministic builds)
- Changes if any identity field changes (version, way, endpoint nodes, index)
- 32-character hex md5

### Split points

Segment boundaries within each way:

1. **Junction nodes**: `route_node.isJunctionNode = true` (node shared by ≥2 ways)
2. **Way start**: `MIN(sequenceIndex)` per way
3. **Way end**: `MAX(sequenceIndex)` per way

Segment `i` runs from split point `[i]` to split point `[i+1]`, inclusive. Every node appears in exactly one segment (with boundary nodes duplicated at segment boundaries — the boundary node is the `to_node_id` of segment `i` and the `from_node_id` of segment `i+1`).

Segment count per way: `Σ(split_points_per_way - 1)`

### Tag derivation

Promoted columns are populated from `osm_way`:
- Direct columns: `highway, surface, tracktype, smoothness, lanes, width, maxspeed, bridge, tunnel, access, service, junction, name`
- From `osm_way."oneWay"` (boolean column)
- From `tags->'ford'`, `tags->'ref'`, `tags->>'layer'`

`extra_tags` = all remaining `osm_way.tags` keys minus the set of promoted keys:
```
{highway, surface, tracktype, smoothness, lanes, width, maxspeed,
 bridge, tunnel, access, service, junction, name, oneway, ford, ref, layer}
```

No tag duplication: promoted keys are NOT stored in `extra_tags`.

### Geometry

Built from `route_node.geom` (geography(Point,4326)) cast to geometry, ordered by `sequenceIndex`:

```sql
ST_MakeLine(rn.geom::geometry ORDER BY rn."sequenceIndex")
```

If `route_node.geom` is NULL for the graph version, the builder backfills it from `(longitude, latitude)`.

---

## 4. Invariants

### Structural

| Invariant | Enforced by |
|-----------|-------------|
| `route_segment.length_m > 0` | CHECK constraint |
| `route_segment.vertex_count >= 2` | CHECK constraint |
| `route_segment.to_sequence_index > from_sequence_index` | CHECK constraint |
| `route_segment.intermediate_count >= 0` | CHECK constraint |
| `route_segment.from_node_id` references valid `route_node.id` | FK constraint |
| `route_segment.to_node_id` references valid `route_node.id` | FK constraint |
| `from_node_id, to_node_id, osm_way_id, graph_version` unique | UNIQUE constraint |
| `route_node."osmWayId", "sequenceIndex"` unique per version | UNIQUE index |

### Geometry

| Invariant | Validated in |
|-----------|-------------|
| `GeometryType = 'LINESTRING'` | Validate build |
| `ST_NumPoints >= 2` | Validate build |
| `ST_Length > 0` | Validate build + CHECK |
| `ST_IsValid = true` | Validate build |
| `ST_SRID = 4326` | Validate build |
| First point matches `from_node_id` coordinates | Validate build |
| Last point matches `to_node_id` coordinates | Validate build |
| Geometry not empty | Validate build |

### Reconstruction proof

For each way, the sum of all segment `osm_node_ids` arrays, concatenated in `segment_index` order with duplicated boundary nodes removed, must exactly match the ordered `_way_nodes` entries for that way.

Count-based formula: `SUM(vertex_count) - COUNT(segments) + 1 = _way_nodes.count` per way.

### Length consistency

For each way:
```
SUM(route_segment.length_m)
≈
ST_Length(ST_MakeLine(all_route_node_geometry))
```

Tolerance: `MAX(0.5m, length * 0.001)`

---

## 5. Validation Rules

All checks in `04-validate-build.ts`. Route segment checks run after way reconstruction and before edge integrity.

### Hard failures (block publish)

| Code | Condition |
|------|-----------|
| `SEGMENT_SPLIT_MISMATCH` | Inserted segment count ≠ expected from split points |
| `SEGMENT_RECONSTRUCTION_FAILED` | Node count formula fails for any way |
| `SEGMENT_GEOMETRY_INVALID` | Any segment fails type/points/length/valid/empty checks |
| `SEGMENT_ENDPOINT_MISMATCH` | First/last geometry point disagrees with from/to node coordinates |
| `SEGMENT_SRID_MISMATCH` | Any segment has SRID ≠ 4326 |
| `WAY_LENGTH_MISMATCH` | Sum of segment lengths per way deviates from way length beyond tolerance |

### Advisory warnings (do not block publish)

| Code | Condition | Notes |
|------|-----------|-------|
| `EDGE_LENGTH_MISMATCH` | Per-way total edge_cache distance ≠ segment length sum | Advisory — oneway directionality and missing forward edges cause expected differences |
| `COMPONENT_FRAGMENTATION` | EdgeCache connectivity components | Advisory — cross-way connections are resolved at query time |

---

## 6. Versioning

### Graph version format

Timestamps (`YYYYMMDD_HHmmss`) for production builds, labels (e.g., `v3-kathmandu`) for development.

### Build isolation

Each `graph_version` is independent. Multiple builds coexist in the same database. Only the active version (pointed to by `graph_config."currentGraphVersion"`) is used at query time.

### Build process

```
1. CREATE TABLE IF NOT EXISTS route_segment
2. BEGIN
3.   DELETE FROM route_segment WHERE graph_version = $1
4.   INSERT INTO route_segment (the big query)
5. COMMIT
6. CREATE INDEX IF NOT EXISTS ...
```

The delete+insert is transactional. If the insert fails, the version's data is rolled back and no incomplete state remains.

### Cleanup

Old builds are pruned by `cleanup-builds.ts`:
- Active build: kept forever
- Recent successful builds: keep last N (default 5)
- Failed/old builds: removed after T days (default 30)

---

## 7. Hazard Architecture Roadmap (Future)

### Phase 1: `hazard` table (independent spatial features) — ✅ Implemented

```sql
CREATE TABLE hazard (
  id            TEXT PRIMARY KEY,
  geometry      GEOMETRY(Geometry, 4326) NOT NULL,  -- POINT, LINESTRING, or POLYGON
  hazard_type   TEXT NOT NULL,    -- landslide, flood, rockfall, closure, ...
  severity      TEXT NOT NULL DEFAULT 'unknown',  -- extreme, high, moderate, low, unknown
  confidence    FLOAT,            -- 0.0–1.0
  source        TEXT,             -- model, survey, report, satellite, ...
  external_id   TEXT,             -- ID in source system
  valid_from    TIMESTAMPTZ,
  valid_to      TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

No FK to roads — hazards survive graph rebuilds.

Imported via `npm run ingest:hazards` (script `06-ingest-hazards.ts`):
- `yatra_disaster_events` (BIPAD): 9,546 events ingested (6 types: landslide, flood, wildlife, earthquake, avalanche, other)
- GeoJSON files: `--geojson <path>`
- CSV files: `--csv <path>` (requires lat/lon columns)
- Idempotent: `ON CONFLICT (id) DO UPDATE`
- Deterministic ID: `md5(source || '|' || external_id)`

### Phase 2: `segment_hazard` (derived intersection table) — ✅ Implemented

```sql
CREATE TABLE segment_hazard (
  segment_id       TEXT NOT NULL REFERENCES route_segment(id) ON DELETE CASCADE,
  hazard_id        TEXT NOT NULL REFERENCES hazard(id) ON DELETE CASCADE,
  overlap_length_m FLOAT NOT NULL,
  start_offset_m   FLOAT NOT NULL,
  end_offset_m     FLOAT NOT NULL,
  affected_percent FLOAT NOT NULL,
  computed_at      TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (segment_id, hazard_id)
);
```

Precomputed via `npm run precompute:hazards` (script `07-precompute-segment-hazards.ts`):

| Geometry type | Match method | Metrics |
|---------------|-------------|---------|
| POINT | `ST_DWithin(geometry, 0.0002° ~20m)` | `start_offset_m = end_offset_m` via `ST_LineLocatePoint`, overlap = 0 |
| LINESTRING / POLYGON | `ST_Intersects` | `overlap_length_m` via `ST_Length(ST_Intersection(...))`, offsets via `ST_LineSubstring` |

Current v3-kathmandu stats:
- 300 segment-hazard intersections from 9,546 BIPAD point hazards
- 89 unique segments affected (0.12% of 71,708)
- 5 hazard types matched: flood (180), landslide (87), wildlife (27), earthquake (5), other (1)

Options:
- `--version <gv>`: Graph version to match against (default: v3-kathmandu)
- `--hazard-type <type>`: Only process hazards of a specific type
- `--recompute-all`: Delete and recompute all intersections
- `--dry-run`: Preview without inserting

### Phase 3: Planner — Not yet implemented

```
User query A→B
    │
    ▼
OSRM route (geometry + instructions)
    │
    ▼
Match route geometry → route_segment(s)
  ST_Intersects(route.geom, segment.geometry)
    │
    ▼
Join to segment_hazard → hazard
  SELECT hazard_type, severity, confidence,
         start_offset_m, end_offset_m
  WHERE segment_id IN (...)
    │
    ▼
Produce per-segment report:
  Prithvi Highway
  • KM 42.3 → KM 42.8  | Landslide  | Extreme (0.92)
  • KM 61.5 → KM 61.9  | Flooding   | Road submerged
```

---

## 8. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Hazards are independent spatial geometries, NOT road annotations | A flood exists at a geographic location; roads merely intersect it. Breaking this coupling means hazards survive graph rebuilds. |
| `segment_hazard` is a precomputed intersection, not queried live | Performance: 1000s of segments × 1000s of hazards at query time is expensive. Precompute offline. |
| RouteSegment splits at junctions + way boundaries (not length-capped) | Semantic homogeneity: a 12km uniform highway is ONE road section. Splitting artificially would create fake boundaries. Sub-segment precision is handled via `start_offset_m`/`end_offset_m`. |
| Tags are promoted to columns + `extra_tags` catch-all | Indexed columns for common queries, zero information loss for uncommon tags. No duplication. |
| No Prisma model for route_segment | Raw SQL table (same pattern as `osm_node`, `_way_nodes`). Simpler, no code generation dependency. |
| `ON CONFLICT` is NOT used — DELETE first, then INSERT | Build steps should fail loudly, not silently skip. If INSERT hits a constraint violation, the crash is the correct behavior. |
| `geometry_hash` stores `md5(ST_AsEWKB(ST_Force2D(geometry)))` | Deterministic fingerprint for rebuild verification, regression testing, diffing graph versions. `ST_Force2D` prevents Z/M coordinate drift from changing the hash. |

---

## 9. Statistics Reference

Validated against the `v3-kathmandu` build:

| Metric | Value |
|--------|-------|
| Route nodes | 537,288 |
| Osm ways | 36,766 |
| Intersections | 43,234 |
| Edge cache entries | 996,083 (500,516 fwd + 495,567 rev) |
| **Route segments** | **71,708** |
| Avg vertices/segment | 8.0 |
| Max vertices/segment | 830 |
| Min vertices/segment | 2 |
| Median segment length | 59 m |
| 95th percentile length | 355 m |
| 99th percentile length | 1,006 m |
| Max segment length | 8,923 m |
| Ways with 0 junctions | 177 |
| Ways all-junction | 3,291 |
| Build time (segments) | ~16 s |
| Validation time | ~32 s |

---

## 10. Development Commands

| Command | Script | Description |
|---------|--------|-------------|
| `npm run import:osm` | `01-import-osm-pbf.ts` | Import PBF to staging tables |
| `npm run build:route-graph` | `02-build-route-graph.ts` | Build route_node + intersections |
| `npm run build:route-segments` | `02b-build-route-segments.ts` | Build route_segment table |
| `npm run build:edge-cache` | `03-build-edge-cache.ts` | Build edge_cache table |
| `npm run validate:build` | `04-validate-build.ts` | Run all validation checks |
| `npm run publish:graph` | `05-publish-graph.ts` | Publish as active version |
| `npm run ingest:hazards` | `06-ingest-hazards.ts` | Ingest hazards from BIPAD/GeoJSON/CSV |
| `npm run precompute:hazards` | `07-precompute-segment-hazards.ts` | Precompute hazard↔segment intersections |
| `npm run cleanup:builds` | `cleanup-builds.ts` | Prune old builds |

### Full build chain

```bash
npm run import:osm -- --version <gv> [--pbf <path>] &&
npm run build:route-graph -- --version <gv> &&
npm run build:route-segments -- --version <gv> &&
npm run build:edge-cache -- --version <gv> &&
npm run validate:build -- --version <gv>
```
