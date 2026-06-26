# Deployment Guide — YatraAI

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ with PostGIS 3.4+
- OpenWeatherMap API key
- Gmail app password (for email notifications)
- SparrowSMS token (for SOS SMS, Nepal)

## Environment Variables

```bash
# Core
DATABASE_URL="postgresql://user:pass@host:5433/yatraai"
NEXT_PUBLIC_APP_URL="https://yatraai.example.com"
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""

# Auth (Better Auth)
BETTER_AUTH_SECRET=""
BETTER_AUTH_URL="https://yatraai.example.com"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Weather & Hazard
OPENWEATHER_API_KEY=""

# Notifications
GMAIL_USER="yatraai@gmail.com"
GMAIL_PASS="app-password"
SPARROW_SMS_TOKEN=""
SPARROW_SMS_FROM="YatraAI"

# Cron
CRON_SECRET="random-secret-shared-with-cron-service"
```

## Database Setup

```bash
# Start PostgreSQL with PostGIS
docker run --name yatra-postgres \
  -e POSTGRES_USER=yatra \
  -e POSTGRES_PASSWORD=yatra123 \
  -e POSTGRES_DB=yatraai \
  -p 5433:5432 \
  -d postgis/postgis:16-3.4

# Init schema + seed
npx prisma generate
npm run db:ensure
npx tsx scripts/seed-corridors.ts
npx tsx scripts/seed-edge-intelligence.ts
```

## Vercel Deployment

1. Connect GitHub repo to Vercel
2. Set all env vars above in Vercel dashboard
3. Framework preset: Next.js
4. Build command: `npx prisma generate && next build`
5. Set `maxDuration: 120` for cron function in `vercel.json`:

```json
{
  "functions": {
    "app/api/cron/refresh-disasters/route.ts": {
      "maxDuration": 120
    }
  }
}
```

## Docker Deployment

```yaml
# docker-compose.yml
version: "3.8"
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: yatra
      POSTGRES_PASSWORD: yatra123
      POSTGRES_DB: yatraai
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5433:5432"

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: "postgresql://yatra:yatra123@db:5432/yatraai"
      NEXT_PUBLIC_APP_URL: "https://yatraai.example.com"
      # ... all other env vars
    depends_on:
      - db

volumes:
  pgdata:
```

## Cron Jobs

Disaster data refresh runs via Vercel Cron, GitHub Actions, or systemd timer:

```
# Every 30 minutes
POST https://yatraai.example.com/api/cron/refresh-disasters
Header: Authorization Bearer <CRON_SECRET>
```

## Health Check

```
GET https://yatraai.example.com/api/health
```

## OSM Edge Enrichment

Run after seeding to fill missing road attributes:

```bash
npx tsx scripts/enrich-edges-from-osm.ts
```

## Monitoring

- Health endpoint: `/api/health` — DB latency, graph stats, env presence
- Disaster pipeline logs: Vercel function logs
- Circuit breaker: per-source in-memory, resets after 60s cooldown
- Safety score cache: 15-min in-memory TTL
