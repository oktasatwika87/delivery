#!/usr/bin/env bash
# refresh-osm.sh — download OSM extract and generate .mbtiles for tileserver-gl.
#
# Usage:
#   ./refresh-osm.sh
#
# Prerequisites:
#   - planetiler JAR: https://github.com/onthegomap/planetiler/releases
#     Download to ./planetiler.jar
#   - Java 17+ installed (for planetiler)
#
# Output:
#   data/bali.mbtiles  — vector tile database (served by tileserver-gl)
#
# Notes:
#   - Geofabrik Nusa Tenggara = Bali + NTB + NTT (~164 MB .pbf)
#   - planetiler filters to Bali bbox [114.5,-9.2,116.0,-7.9]
#   - Run on local machine, then scp data/ folder to VPS:
#       scp -r infra/tileserver/data/ user@vps:/opt/tileserver/data/
#   - Monthly cadence: re-run this script when OSM data needs refresh
#     (Bali roads/POIs change infrequently — monthly is fine for MVP)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
PBF_URL="https://download.geofabrik.de/asia/indonesia/nusa-tenggera-latest.osm.pbf"
# Note: "nusa-tenggera" not "nusa-tenggara" — Geofabrik uses different spelling

# Bali bounding box (lng_min, lat_min, lng_max, lat_max)
BALI_BOUNDS="114.5,-9.2,116.0,-7.9"

echo "=== OSM Refresh: Bali (Nusa Tenggara extract) ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ── Step 1: Ensure data directory exists ──────────────────────────────────────
mkdir -p "${DATA_DIR}"

# ── Step 2: Download Geofabrik extract (only if not exists or stale) ───────────
PBF_FILE="${DATA_DIR}/nusa-tenggera-latest.osm.pbf"
if [[ ! -f "${PBF_FILE}" ]]; then
    echo "Downloading Geofabrik Nusa Tenggara extract (~164 MB)..."
    curl -L -o "${PBF_FILE}" "${PBF_URL}"
    echo "Download complete: ${PBF_FILE}"
else
    echo "Using cached PBF: ${PBF_FILE} ($(du -h "${PBF_FILE}" | cut -f1))"
    echo "To re-download, delete ${PBF_FILE} and re-run this script."
fi

# ── Step 3: Run planetiler to generate .mbtiles ───────────────────────────────
MBTILES_FILE="${DATA_DIR}/bali.mbtiles"

# planetiler JAR path — must be in same dir as this script or in PATH
PLANETILER_JAR="${SCRIPT_DIR}/planetiler.jar"
if [[ ! -f "${PLANETILER_JAR}" ]]; then
    PLANETILER_JAR="planetiler.jar"  # fallback: look in PATH
    if ! command -v planetiler &>/dev/null; then
        echo "ERROR: planetiler.jar not found in ${SCRIPT_DIR} and not in PATH."
        echo "Download from: https://github.com/onthegomap/planetiler/releases"
        echo "Expected path: ${PLANETILER_JAR}"
        exit 1
    fi
fi

echo "Running planetiler (this may take 10-30 minutes on first run)..."
echo "Bali bbox: ${BALI_BOUNDS}"
echo "Output: ${MBTILES_FILE}"

java -Xmx2g -jar "${PLANETILER_JAR}" \
    --area=monaco \
    --bounds="${BALI_BOUNDS}" \
    --download="${PBF_FILE}" \
    --output="${MBTILES_FILE}" \
    --force \
    2>&1 | tee "${DATA_DIR}/planetiler.log"

# ── Step 4: Verify output ──────────────────────────────────────────────────────
if [[ -f "${MBTILES_FILE}" ]]; then
    SIZE=$(du -h "${MBTILES_FILE}" | cut -f1)
    echo ""
    echo "=== SUCCESS ==="
    echo "Output: ${MBTILES_FILE} (${SIZE})"
    echo ""
    echo "To deploy to VPS:"
    echo "  scp -r ${SCRIPT_DIR}/data/ user@vps:/opt/tileserver/data/"
    echo ""
    echo "Then restart tileserver:"
    echo "  ssh user@vps 'cd /opt/tileserver && docker compose restart'"
else
    echo "ERROR: planetiler failed to produce ${MBTILES_FILE}"
    echo "Check ${DATA_DIR}/planetiler.log for details"
    exit 1
fi

echo ""
echo "Refresh complete at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
