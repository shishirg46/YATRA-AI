# AGENTS.md — Yatra AI Engineering Log

## 2026-07-06 — Signal propagation & timeout fix

### Problem

Two log messages observed in production:

1. `[external-cache] MISSING_SIGNAL { key: 'openaq:28.2:84.0' }` — `ExternalApiCache` warns because callers don't pass an `AbortSignal`.
2. `[weather] DHM timed out — skipping` — DHM weather provider times out (expected, fallback works).

### Root cause

**Issue 1:** `fetchHazard` accepts an optional `signal?: AbortSignal` parameter and forwards it correctly through `fetchAirQuality` → `fetchOpenAQ`/`fetchOwmAirQuality` → `externalApiCache.getOrFetch(..., { signal })`. However, most callers omit the signal argument entirely. Only `realtime/route.ts` passes `tickAbort.signal`. The other 7+ API route handlers and all library callers leave it undefined.

**Issue 2:** DHM is a Nepal-specific weather provider. For coordinates around 28.2°N, 84.0°E (Nepal/Tibet region), it can be slow. The 3-second internal timeout fires, the catch block logs the warning, and `fetchWeather` falls through to Open-Meteo → OpenWeatherMap. This is graceful degradation, not a bug.

### Changes (18 files)

#### Signal propagation

- **`lib/destinations/live.ts`** — Added `signal?: AbortSignal` to `computeDestinationLive`. Passes it to `fetchWeather` and `fetchHazard`.
- **`lib/collectors/weather-dhm.ts`** — Added `signal?: AbortSignal` to `fetchWeather`. Added `composeSignal()` helper (`AbortSignal.any([signal, timeout])`). All three providers (DHM, Open-Meteo, OWM) use it. DHM catch block distinguishes timeout vs client-abort vs genuine error.
- **`app/api/destinations/[id]/live/route.ts`** — Passes `_req.signal` to `externalApiCache.getOrFetch` and `computeDestinationLive`.
- **`app/api/destinations/[id]/route.ts`** — `fetchWeather(..., _req.signal)` + `fetchHazard(..., _req.signal)`
- **`app/api/plan/route.ts`** — `fetchWeather(..., req.signal)` + `fetchHazard(..., req.signal)`
- **`app/api/assess/route.ts`** — `fetchWeather(..., req.signal)` + `fetchHazard(..., req.signal)`
- **`app/api/segments/hazard-patterns/route.ts`** — `fetchWeather(..., req.signal)` + `fetchHazard(..., req.signal)`
- **`app/api/dashboard/route.ts`** — `fetchHazard(..., request?.signal)`
- **`app/api/routes/check/route.ts`** — `fetchWeather(..., req.signal)` + `fetchHazard(..., req.signal)` + `fetchHistoricalHazard(..., req.signal)`
- **`app/api/realtime/route.ts`** — `fetchWeather(..., req.signal)`

#### Noise reduction

- **`lib/collectors/external-api-cache.ts:69`** — `MISSING_SIGNAL` removed entirely. Signals are optional; the warning was noise for legitimate callers without one.

#### Not changed (intentionally)

- Library callers (pillar-score, group-risk, route-safety, pipeline, route-intelligence) — no signal source, left as-is.
- Cron route — no client connection, no cancellation benefit.
- `computeDestinationLive` signal is only forwarded to weather/hazard — not to DB queries (no benefit).
- `external-request.ts` resilience abstraction — deferred to follow-up PR.

#### Unsupported region fallback fix

- **`lib/routing/geo.ts`** — Added `UnsupportedRegionError` class (typed error for outside-Nepal routing requests).
- **`lib/routing/route-service.ts`** — Two throw sites (`Origin is outside Nepal`, `Destination is outside Nepal`) now throw `UnsupportedRegionError` instead of generic `Error`.
- **`lib/route-intelligence.ts`** — `buildRouteCore()` catch block checks `instanceof UnsupportedRegionError`. When true, sets `skipFallback = true` so the ORS fallback (`fetchRoadRoutesFallback`) is skipped. Eliminates secondary 400 errors from calling ORS with invalid coordinates.

### Verification

- Normal request succeeds.
- HTTP cancellation aborts in-flight weather/hazard fetches.
- DHM still times out after 3s (same behavior).
- Library callers without signal work unchanged.
- `MISSING_SIGNAL` warnings eliminated from normal operation.
- Cache dedup unaffected (signal not part of cache key).
- Origin/destination outside Nepal → `UnsupportedRegionError` thrown, ORS fallback skipped, no secondary 400.
- Valid Nepal route + provider failure → ORS fallback still runs (unchanged).

## 2026-07-06 (later) — Disaster data pipeline: domain module, DB-only analysis, USGS backfill

### Problem

`fetchHistoricalHazard()` called BIPAD + USGS APIs on every analysis request — 2 external HTTP calls per request, mitigated only by a 24-hr cache. `classifyType()` was an `if/else` chain inside `disaster-pipeline.ts`, making it unreusable and hard to extend. `ingestHistoricalUsgs()` didn't exist — only BIPAD had a historical backfill.

### Changes (9 files)

#### Domain module (new)

- **`lib/disaster/types.ts`** — Extracted `DisasterType` union (now 8 values: `earthquake`, `flood`, `landslide`, `storm`, `accident`, `fire`, `avalanche`, `other`) and `TYPE_PATTERNS` config map. Adding a new type is a one-line data change.
- **`lib/disaster/classifier.ts`** — Extracted `classifyType()` as a standalone function using `TYPE_PATTERNS`. Shared single source of truth — ingestion, reclassification, and any future consumers all use the same logic.

#### `lib/disaster-pipeline.ts`

- Import `DisasterType` and `classifyType` from the new domain module (removed inline definition).
- **`ingestHistoricalUsgs({ fromYear?, incremental? })`** — New function. Bootstrap mode fetches from 2020 forward. Incremental mode queries `MAX(date)` in DB and only fetches uningested years. Nepal bounding box, minmag=3.0, upserts via `storeDisasterEvents()`.
- **`ensureDisasterEventTable()`** — Added composite indexes `idx_de_source_date` and `idx_de_source_type_date`. Added `updated_at` column (set on every upsert). Added TODO comment for district normalization.
- **`storeDisasterEvents()`** — Changed to parameterized `$queryRaw`. On CONFLICT, sets `updated_at = NOW()` and overwrites severity/metadata.

#### `lib/collectors/historical-hazard.ts` (rewrite)

Removed:
- `import { externalApiCache }` (~120 lines of API code)
- `fetchBipadHistorical()`, `fetchBipadRange()`, `fetchUsgsHistorical()`
- `BipadStats`, `UsgsStats`, `BipadIncident` interfaces
- `HAZARD_TERMS` constant

Replaced with 4 parameterized `$queryRaw` queries against `yatra_disaster_events`:
1. BIPAD counts by district + month window (IN clause with `Prisma.join()`)
2. BIPAD notable events (top 10, ordered by date)
3. USGS earthquake stats by lat/lon bounding box + month window
4. USGS notable events (mag >= 5.0, top 5)

Month filtering uses circular wrap (correct for Dec→Jan). Output shape (`HistoricalHazardStats`) preserved. Confidence is now always 1.0 (DB is always available). Sources changed to `["yatra_disaster_events"]`.

#### Other files

- **`lib/plan/pipeline-types.ts`** — Changed import of `DisasterType` from `@/lib/disaster-pipeline` to `@/lib/disaster/types`.
- **`app/api/cron/refresh-disasters/route.ts`** — Added `ingestHistoricalUsgs({ incremental: true })` call alongside historical BIPAD.

#### Scripts (one-time / temporary)

- **`scripts/compare-historical-hazard.ts`** — Side-by-side comparison runner. Validates DB implementation against shape, range, and semantic correctness. Run before PR 2 deletes old API code.
- **`scripts/reclassify-other.ts`** — Batch reclassifies existing `type = 'other'` records using the shared `classifyType()`. Batches of 500 in transactions. Idempotent — logs scanned, updated, skipped, remaining.

### Verification

- `npm run typecheck` — zero errors.
- `npm run lint` — zero warnings.
- `fetchHistoricalHazard()` now reads from `yatra_disaster_events` only — zero external HTTP calls.
- All 6 callers (pillar-score, temporal-risk, route-safety, pipeline, route-intelligence, check/route) receive unchanged output shape.
- Old API functions marked for removal in PR 2 (after side-by-side validation).
- Reclassification script safely idempotent — second run has zero "other" records to update.

### Next steps

1. **PR 2** — Remove old API code (`fetchBipadRange`, `fetchUsgsHistorical`, HAARD_TERMS, ExternalApiCache import) after side-by-side comparison confirms data parity.
2. **District normalization** — Promote `metadata->>'district'` to a real column once query volume justifies it.
3. **Weather provider observability** — Track per-provider calls, successes, timeouts, errors.
4. **Single-flight for `weatherCache`** — After observability data informs the approach.
5. **Storm/accident scoring** — Decide whether to include in route risk scoring after enough data collected.

## 2026-07-06 — Phase 1: Route explanation formatter

### What changed

- **`lib/types/plan-report.ts`** — Added `from: string` and `to: string` to `routePlan` type (derived from `nodes[0]?.name` and `nodes[last]?.name`).

- **`lib/explain/formatters/route-explanation.ts`** (new) — `formatRouteExplanation(input)` replaces English route items in `riskExplanation` with structured output:
  - Hazard dedup: regex-based categorization (Flood, Landslide, Seismic, Weather) collapses redundant mentions per category.
  - Segment details: top 2 shown, remainder counted ("N more segments with moderate risk").
  - Worst-segment: `reduce` by `riskScore` numeric comparison.
  - Empty-segment guard: when `segments.length === 0` (route exists but no detail segmentation), returns graceful fallback — no "0 segments" text, preserves corridor/distance/risk, actionable advice.
  - Traveler-focused phrasing: `"has N segments requiring extra caution"` instead of `"contains N segments"`.
  - `riskExplanation`: formatter output joined with non-route HIGH/MEDIUM items from the explanation engine.
  - `routeAdvice`: structured block (status, corridor, segment bullets, HIGH/EXTREME recommendation).
  - Feature flag `NEW_ROUTE_FORMATTER` gates the new path; old path untouched when flag is off.

- **`lib/plan/pipeline.ts`** — Three integrations:
  1. `from`/`to` derivation added at both routePlan construction sites (stage + buildResponse).
  2. `stageGenerateAiNarrative()` captures `report` from `runExplanationEngine()`, uses it for `isRouteCondition()` filtering.
  3. `isRouteCondition()` helper: matches `route_*` prefix, `segment_*` prefix, or `disaster_route_risk` set.

- **`app/api/plan/route.ts`** — Added `from`/`to` to the third routePlan construction site.

### Key decisions

- **Phase 1 only**: formatter deduplicates at consumption side — no producer refactors, no UI changes, no template changes.
- **Hazard grouping via regex**: string categories (`/flood/i` → "flood") sufficient for now; Phase 2 will switch to structured `HazardFacts`.
- **`isRouteCondition()` centralizes route-item detection**: uses stable condition prefixes, not content regex.
- **`routeAdvice` populated but not rendered**: deferred until UI is ready for a dedicated route card.
- **Empty-segment is a presentation state**: early return in formatter, not surfaced as "0 segments."
- **`EXTREME` preserved**: no collapsing to `HIGH` — it's a public-facing safety level across the UI.

### Verification

- `npm run typecheck` — zero errors.
- `npm run lint` — zero warnings.
- Normal route with segments → unchanged behavior.
- Empty-segment route → graceful fallback, no "0 segments" text.
- Flag off → old engine runs identically.
- No API contract, scoring, persistence, or caching changes.

### Next steps

1. Enable `NEW_ROUTE_FORMATTER=1` in development; test 5–10 routes (safe, medium, high, blocked).
2. Manual UI check: normal route, empty-segment route, low-risk route.
3. Ship flag to production after verification.
4. **Phase 2**: Convert `route-intelligence.ts` hazard strings to structured `HazardFacts`.
5. **Phase 3**: Refactor remaining producers (pillar-score, alert-engine) to emit structured data.
6. **Phase 4**: Simplify templates.
7. **Phase 5**: Delete legacy English-generation code.
