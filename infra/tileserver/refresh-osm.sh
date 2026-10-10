#!/usr/bin/env bash
# refresh-osm.sh - unduh PBF Geofabrik dan hasilkan mbtiles Bali via planetiler Docker.
#
# Prasyarat: Docker.
#
# Penggunaan:
#   ./refresh-osm.sh
#
# Hasil: data/bali.mbtiles (terbatas ke bbox Bali).
#
# Catatan: Image planetiler di GHCR (bukan Docker Hub). Tag 0.10.2 adalah rilis stabil.
#   Untuk paksa unduh ulang PBF, hapus data/sources/nusa_tenggara.osm.pbf dulu.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"

echo "=== Segarkan OSM: Bali (terbatas dari Geofabrik Nusa Tenggara) ==="
echo "Tanggal: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Bbox Bali: minLng,minLat,maxLng,maxLat
BALI_BOUNDS="114.40,-8.90,115.75,-8.00"

echo "Menjalankan planetiler..."
docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx2g" \
  -v "${DATA_DIR}:/data" \
  ghcr.io/onthegomap/planetiler:0.10.2 \
  --download \
  --area=nusa-tenggara \
  --bounds="${BALI_BOUNDS}" \
  --output=/data/bali.mbtiles \
  --force
