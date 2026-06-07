# YatraAI

**AI-powered travel safety and route intelligence for Nepal.**

Real-time safety scores, hazard alerts, and personalized travel advisories for every destination in Nepal.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up PostgreSQL with PostGIS
npm run db:reset

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local with your keys (DATABASE_URL, API keys, etc.)

# 4. Run database migrations
npx prisma migrate dev

# 5. Start dev server (Ollama + Next.js)
./start-dev.sh
```

Open [http://localhost:3000](http://localhost:3000).

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm test` | Run test suite (Vitest) |
| `npm run lint` | Lint all files |
| `npm run db:reset` | Reset PostgreSQL container |
| `npm run ingest:disasters:realtime` | Fetch recent disaster data |
| `npm run seed:wikipedia-osm` | Seed destination data |

---

## Architecture

```
app/          Next.js App Router (pages + API routes)
lib/          Core logic: scoring, routing, AI, analysis, cache
components/   React components (UI primitives + feature components)
services/     External service integrations (Wikipedia, Cloudinary)
prisma/       Database schema + migrations
scripts/      Data ingestion and seeding utilities
ollama/       Local LLM runtime (bundled)
```

---

## Key Features

- **Safety Scoring** — Multi-factor risk model (altitude, weather, terrain, seismic, hazards)
- **Route Intelligence** — Per-segment hazard analysis with turn-by-turn directions
- **AI Reasoning** — Personalized safety explanations (local Ollama, no API key needed)
- **Real-time Alerts** — Disaster data from BIPAD portal + USGS
- **Emergency SOS** — Alert system with emergency contacts
- **Trip Planning** — Group trips, member management, budget tracking
- **Destination Discovery** — Browse Nepal destinations with live safety data
- **Admin Panel** — Analytics, moderation, user management, audit logs

---

## Database

PostgreSQL with PostGIS extension. Key models:

- `User`, `UserHealth`, `UserPreference` — User profiles with health data
- `Destination`, `Province`, `District` — Nepal geography
- `RouteNode`, `RouteEdge`, `RouteTemplate` — Road network graph
- `RiskAssessment`, `HazardData`, `WeatherData` — Safety data
- `TravelPlan`, `TravelStop`, `TravelGroup` — Trip management
- `EmergencyAlert`, `EmergencyContact` — SOS system

---

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AI_PROVIDER` | `ollama` (default), `groq`, `gemini`, or `claude` |
| `OLLAMA_BASE_URL` | Custom Ollama server URL |
| `OPENWEATHER_API_KEY` | Weather data |
| `OPENROUTESERVICE_API_KEY` | Route calculation |

---

## Testing

```bash
npm test          # Run all tests
npx vitest        # Watch mode
npx vitest run    # Single run
```

---

## Deployment

Deploys to Vercel. The `vercel.json` includes a cron job for hourly disaster data ingestion.
