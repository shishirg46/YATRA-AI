# OSRM Docker Setup (Nepal)

Run a local OSRM routing engine for Nepal inside Docker.

## Prerequisites

- Docker (or Podman with docker compatibility)
- ~5GB free disk space
- Internet connection (one-time download ~200MB)

## Quick start

```bash
chmod +x setup.sh
./setup.sh
```

This downloads Nepal OSM data, runs extract/partition/customize, and starts the server.

## Manual steps

### 1. Prepare data directory

```bash
mkdir osrm-data
cd osrm-data
wget https://download.geofabrik.de/asia/nepal-latest.osm.pbf
```

### 2. Extract (build routing graph)

```bash
docker run -t -v "${PWD}:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/nepal-latest.osm.pbf
```

### 3. Partition (MLD algorithm)

```bash
docker run -t -v "${PWD}:/data" osrm/osrm-backend \
  osrm-partition /data/nepal-latest.osrm
```

### 4. Customize

```bash
docker run -t -v "${PWD}:/data" osrm/osrm-backend \
  osrm-customize /data/nepal-latest.osrm
```

### 5. Start server

```bash
docker run -d -p 5000:5000 -v "${PWD}:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/nepal-latest.osrm
```

### 6. Verify it works

```bash
curl 'http://localhost:5000/route/v1/driving/85.3240,27.7172;85.3240,27.7000?overview=full'
```

### 7. Configure your app

```bash
export OSRM_URL=http://localhost:5000
```

Or add to your `.env.local`:

```
OSRM_URL=http://localhost:5000
```

## What OSRM gives you

| Data | Description |
|---|---|
| Route geometry | Ordered list of lat/lon coordinates along roads |
| Distance | Total route distance in meters |
| Duration | Estimated travel time in seconds |
| Steps | Turn-by-turn instructions (optional) |

**OSRM does NOT give:** place names, city/town labels, semantic data.

## Architecture

```
OSRM (Docker) ──► route geometry (coordinates)
Nominatim     ──► place names (reverse geocode)
Your code     ──► merge geometry + names → clean segments
```

## Useful commands

```bash
# Stop the container
docker ps | grep osrm-routed | awk '{print $1}' | xargs docker stop

# View logs
docker ps | grep osrm-routed | awk '{print $1}' | xargs docker logs

# Check if running
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000
```

## Notes

- First run (extract) takes ~2-5 minutes depending on hardware
- Server uses ~1-2GB RAM while running
- No rate limits compared to public `router.project-osrm.org`
- Works offline after initial data download and processing
