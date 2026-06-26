# System Contract & Runtime Model

## 1. System Overview

Three-plane architecture for route computation with hazard overlay:

| Plane | Role | Synchrony | Guarantee |
|-------|------|-----------|-----------|
| **Routing** (kernel) | A\* shortest-path + ORS geometry | Synchronous (<3s) | Always returns structural route |
| **Intelligence** (engine) | Hazard scoring, segment analysis, alert generation | Async (worker-backed) | Eventually consistent |
| **Delivery** (UX) | Degraded-first rendering + polling upgrade | Reactive | Never blocked by intelligence |

Invariant: Plane 1 never depends on Plane 2. Plane 3 renders whatever Plane 1 produces, then upgrades when Plane 2 completes.

---

## 2. Truth Hierarchy (READ PATH ONLY)

Completion state flows through exactly three levels, in this order:

```
Level 1 (L1):  intelligenceCache (in-memory Map)
               — Performance hint only
               — MAY be stale → never trusted for correctness
               — TTL-validated before use

Level 2 (L2):  RouteIntelligenceJob (DB row)
               — SOURCE OF TRUTH for "complete"
               — Only status === "done" AND result != null = authoritative
               — Cache is hydrated FROM this level, never the other way

Level 3 (L3):  buildRouteUltraFast + enqueueRouteIntelligence
               — Executed only when L1 + L2 both miss
               — Always returns "degraded" status
               — Enqueues background job for eventual L2 write
```

Enforcement:
- Handler never infers "complete" from cache alone
- Handler reads DB before falling through to compute
- Cache is ephemeral, reconstructable, non-authoritative

---

## 3. Execution Pipeline

### P0 — DB Truth Cascade (Handler)
```
request → makeIntelligenceKey
  → L1: intelligenceCache.get(key)
    ├── hit + valid TTL → return { status: "complete" }
    └── miss
  → L2: RouteIntelligenceJob.findUnique({ where: { key } })
    ├── status === "done" → hydrate cache, return { status: "complete" }
    └── otherwise
  → L3: buildRouteUltraFast() + enqueueRouteIntelligence()
    → return { status: "degraded" }
```

### P1 — Budget-Based Cancellation

Two distinct cancellation primitives, never mixed:

| Scope | Primitive | Behavior |
|-------|-----------|----------|
| HTTP (ORS, external APIs) | `AbortSignal` via `AbortSignal.any([external, timeout])` | **Real stop** — socket closed, retries aborted, no upstream load |
| Internal (Prisma, A\*, graph) | `withTimeout(ms)` | **Wait cutoff** — promise rejected, underlying work continues to completion |

Handler creates `AbortController` with 15s SLA timer. Signal propagates through `buildRouteUltraFast` → `fetchRouteGeometry` → `fetchWithRetry` only. Neither `resolveDestination` nor `buildSegmentedRoute` receive the signal — they use `withTimeout` alone.

### P2 — Frontend Bounded Polling

Polling observes, never initiates:

```
State machine:
  pending ──→ complete   (hazard data arrived)
  pending ──→ expired    (MAX_POLL_ATTEMPTS = 10, ~2-3 min)
  pending ──→ error      (non-OK response)
```

Three banner states:
- **pending** — amber: "Hazard analysis pending"
- **expired** — muted: "Hazard analysis unavailable"
- **complete** — no banner

Reset on modal open. Polling stops when `pollingKey` is set to `null`.

### Cache Hydration (Two Paths)

| Path | When | Scope |
|------|------|-------|
| `warmupCache()` | Worker startup | Bulk: up to 200 recent `done` jobs |
| Handler lazy hydration | Per-request, on L2 hit | Single key |

Both write to the same `intelligenceCache` Map. `Map.set` is idempotent — no locking required.

---

## 4. Key Invariants

- **Cache never defines completeness.** Only `RouteIntelligenceJob.status === "done"` + `result != null` is authoritative.
- **AbortSignal is for HTTP only.** Never passed to Prisma, A\*, or graph traversal.
- **Prisma never receives cancellation.** Internal DB/CPU work uses `withTimeout` for wait-cutoff only.
- **Worker is eventually consistent.** System correctness is request-driven, not worker-driven. Worker can die, restart, or be delayed without correctness impact.
- **Frontend never influences backend state.** Polling is a read-observer, not a trigger.
- **Cancellation ≠ stop for internal work.** "Stopped waiting" ≠ "stopped executing" for Prisma/graph tasks. This is correct and expected.

---

## 5. Known Non-Bug (Race Condition)

**Scenario:** Two concurrent requests for the same route key arrive milliseconds apart. Both miss L1 cache. Both hit L2 DB which says "done". Both hydrate the cache. One starts `buildRouteUltraFast` before the other's cache write is visible.

**Effect:** Duplicate ultra-fast compute (~<3s). The `enqueueRouteIntelligence` call hits the `@@unique([key])` constraint and the `processing` guard — the second enqueue becomes a no-op.

**Why it's acceptable:**
- Bounded cost: <3s of redundant A\* + ORS geometry
- No correctness impact: both requests return the same structural route
- No user-visible effect: the first response already served the data
- Suppressed by DB unique key, not by fragile timing

**If this ever becomes a scaling bottleneck:** add a single-flight DB read lock per key at L2. Not needed at current scale.

---

## 6. Failure Modes

| Failure | Behavior | Recovery |
|---------|----------|----------|
| ORS latency spike | `fetchRouteGeometry` times out (10s `withTimeout`) → A\*-only polyline returned | Enqueued worker retries ORS later with exponential backoff |
| Worker crash | In-memory cache empty after restart | `warmupCache()` reloads recent `done` jobs from DB. Handler lazy hydration fills per-key gaps. |
| Prisma slow / down | `resolveDestination` / `buildSegmentedRoute` time out (10s `withTimeout`) → coordinates kept as-is | Route still returns with A\* waypoints + ORS geometry. No correctness loss, slightly degraded naming. |
| DB cold start (no existing jobs) | L2 returns no row → falls through to L3 compute + enqueue | System converges normally on first request. No special handling needed. |
| Frontend abort before response | Backend continues `buildRouteUltraFast` to completion | Response is discarded by client. Cache not written (no "complete" to cache). Next request re-computes. |
| Multiple worker instances | `lockUntil` + `status` guard prevents duplicate processing | One worker claims each job; others skip. Race window between `findMany` and `updateMany` is handled by the WHERE clause re-check. |
