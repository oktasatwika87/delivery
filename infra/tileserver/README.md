# Server Peta Bali (tileserver-gl)

Layanan vector tile Bali untuk app mobile, dijalankan via tileserver-gl-light di Docker.

## Mulai cepat

```bash
# Hasilkan data/bali.mbtiles dari Geofabrik (satu kali, atau saat data OSM perlu disegarkan)
./refresh-osm.sh

# Nyalakan tile server
docker compose up -d

# Verifikasi style JSON
curl http://localhost:8080/styles/bali/style.json | python -m json.tool
```

## Daftar berkas

| Berkas | Tujuan |
|---|---|
| `docker-compose.yml` | Container tileserver-gl-light (image v5.6.0) |
| `config.json` | Konfigurasi tileserver (paths, daftar style, daftar data) |
| `styles/bali/style.json` | Style MapLibre yang dilayani ke app |
| `refresh-osm.sh` | Unduh PBF Geofabrik dan hasilkan `bali.mbtiles` via planetiler Docker |
| `data/` | Data runtime — berisi `bali.mbtiles` (gitignored) |
| `Caddyfile` | Reverse proxy HTTPS dengan auto-TLS (untuk deploy VPS) |

## Deploy ke VPS (belum dikerjakan)

Bagian ini belum diuji. Untuk produksi, langkah umumnya:

1. Siapkan VPS (mis. DigitalOcean Singapore, 1 GB RAM cukup).
2. Siapkan DNS A record `tiles.example.com` ke IP VPS.
3. Salin folder `infra/tileserver/` ke `/opt/tileserver/` di VPS.
4. Jalankan `./refresh-osm.sh` di VPS untuk hasilkan `bali.mbtiles`.
5. `docker compose up -d` di VPS.
6. Deploy `Caddyfile` ke `/etc/caddy/Caddyfile` dan `caddy reload`.

`Caddyfile` sudah ada di folder ini dan tidak diubah.

## Endpoint

| Endpoint | Keterangan |
|---|---|
| `/styles/bali/style.json` | Style MapLibre untuk offline pack di app (MapView memakai style bawaan app yang mengambil ubin lewat /data/bali.json) |
| `/data/bali.json` | TileJSON — daftar tile vector + attribution + bounds |
| `/data/bali/{z}/{x}/{y}.pbf` | Vector tile per koordinat slippy |

URL tile di TileJSON dibangun tileserver-gl dari `Host` header request, jadi app mobile yang request lewat IP Tailscale akan menerima URL tile yang memakai host itu.

## Batasan

- **Tanpa label jalan (glyphs)**: style `bali` tidak punya `glyphs`, jadi nama jalan tidak ditampilkan. Peta tetap menampilkan garis transportation untuk navigasi. Label nama jalan adalah peningkatan di masa depan.
- **Tanpa sprite ikon**: style tidak punya `sprite`, jadi tidak ada ikon POI.
- **Hanya Bali**: `bali.mbtiles` dipotong ke bbox `114.40,-8.90,115.75,-8.00`. Tidak termasuk Lombok atau Jawa.

## Tentang data

`bali.mbtiles` dihasilkan dari `planetiler-openmaptiles` (skema OpenMapTiles 3.16). Image planetiler dipakai lewat Docker dari GHCR:

```
ghcr.io/onthegomap/planetiler:0.10.2
```

Tag `0.10.2` adalah rilis stabil; tag `latest` dan `snapshot` menunjuk ke build prarilis.
