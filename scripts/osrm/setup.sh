#!/usr/bin/env bash
set -euo pipefail

OSRM_DIR="${1:-./osrm-data}"
OSRM_IMAGE="osrm/osrm-backend"

echo "=== OSRM Nepal Setup ==="
echo "Data directory: $OSRM_DIR"
echo

mkdir -p "$OSRM_DIR"
cd "$OSRM_DIR"

if [ ! -f nepal-latest.osm.pbf ]; then
  echo "Downloading Nepal OSM data..."
  wget https://download.geofabrik.de/asia/nepal-latest.osm.pbf
else
  echo "nepal-latest.osm.pbf already exists, skipping download"
fi

echo
echo "=== Step 1: Extract ==="
docker run -t -v "${PWD}:/data" "$OSRM_IMAGE" \
  osrm-extract -p /opt/car.lua /data/nepal-latest.osm.pbf

echo
echo "=== Step 2: Partition (MLD) ==="
docker run -t -v "${PWD}:/data" "$OSRM_IMAGE" \
  osrm-partition /data/nepal-latest.osrm

echo
echo "=== Step 3: Customize ==="
docker run -t -v "${PWD}:/data" "$OSRM_IMAGE" \
  osrm-customize /data/nepal-latest.osrm

echo
echo "=== Step 4: Start server ==="
docker run -d -p 5000:5000 -v "${PWD}:/data" "$OSRM_IMAGE" \
  osrm-routed --algorithm mld /data/nepal-latest.osrm

echo
echo "=== Done ==="
echo "OSRM server running at http://localhost:5000"
echo
echo "Test it:"
echo "  curl 'http://localhost:5000/route/v1/driving/85.3240,27.7172;85.3240,27.7000?overview=full'"
echo
echo "Then set in your env:"
echo "  OSRM_URL=http://localhost:5000"
