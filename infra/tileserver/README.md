# Self-Hosted OSM Tile Server (tileserver-gl)

Self-hosted vector tiles for Bali, served via tileserver-gl in Docker on a VPS with Caddy auto-TLS.

**Why self-host?** MapTiler's cheapest plan is $25/mo — over the $10/mo budget. Demotiles only goes to zoom 6, useless for street-level offline packs (zoom 10-16).

## Quick Start (Local Dev)

```bash
# One-time: download OSM data and generate tiles
chmod +x refresh-osm.sh
./refresh-osm.sh

# Start tileserver-gl
docker compose up

# Verify
curl http://localhost:8080/data/bali.json | jq .name
# → "bali"
```

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | tileserver-gl container (reads .mbtiles from ./data/) |
| `refresh-osm.sh` | Download Geofabrik extract + run planetiler → bali.mbtiles |
| `Caddyfile` | HTTPS reverse proxy with auto-TLS (production only) |
| `data/` | Runtime data — contains bali.mbtiles (gitignored) |

## Production Deploy

### 1. Provision VPS

Recommended: DigitalOcean Basic Droplet ($4–6/mo, Singapore region).

```bash
# SSH into VPS
ssh root@1.2.3.4

# Install Docker
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose

# Create directory
mkdir -p /opt/tileserver
```

### 2. Copy files to VPS

```bash
# From your local machine:
scp -r infra/tileserver/ user@vps:/opt/tileserver/

# Set up DNS A record: tiles.example.com -> <vps-ip>
# (Use your domain registrar's DNS settings)
```

### 3. Update Caddyfile domain

Edit `/opt/tileserver/Caddyfile` — replace `tiles.example.com` with your actual domain.

### 4. Generate tiles locally and upload

```bash
# On local machine:
./refresh-osm.sh

# Upload to VPS:
scp -r infra/tileserver/data/ user@vps:/opt/tileserver/data/
```

### 5. Start tileserver-gl

```bash
ssh user@vps
cd /opt/tileserver
docker compose up -d
```

### 6. Deploy Caddy

```bash
# Install Caddy
ssh user@vps 'curl -fsSL https://get.docker.com | sh && docker pull caddy:2'

# Deploy Caddyfile
scp infra/tileserver/Caddyfile user@vps:/etc/caddy/Caddyfile
ssh user@vps 'caddy fmt --overwrite /etc/caddy/Caddyfile'
ssh user@vps 'caddy reload --config /etc/caddy/Caddyfile'
```

### 7. Verify

```bash
# Check tileserver is running
curl http://localhost:8080/data/bali.json | jq .name

# Check HTTPS via Caddy
curl -I https://tiles.example.com/data/bali.json
```

## OSM Data Refresh

When Bali's OSM data needs updating (new roads, POI changes):

```bash
# On local machine:
./refresh-osm.sh

# Upload new tiles to VPS:
scp -r infra/tileserver/data/ user@vps:/opt/tileserver/data/

# Restart tileserver:
ssh user@vps 'cd /opt/tileserver && docker compose restart tileserver'
```

**Cadence**: Monthly is fine for MVP. OSM Indonesia changes frequently in urban areas, but not so fast that weekly updates are needed.

## Cost

| Item | Monthly Cost |
|------|-------------|
| VPS (DigitalOcean/Vultr, 1GB RAM) | $4–6 |
| Domain (optional, tiles.example.com) | ~$1–2 |
| **Total** | **$4–8/mo** |

Without a domain, use the VPS IP directly: `TILE_BASE_URL=http://1.2.3.4:8080`. Rebuild APK if VPS IP changes.

## Tile Endpoints

| Endpoint | Description |
|----------|-------------|
| `/styles/bali/style.json` | Map style (used by mobile app) |
| `/data/bali.json` | TileJSON metadata |
| `/data/bali/{z}/{x}/{y}.pbf` | Vector tiles |
| `/sprites/bali.json` | Sprite sheet |

## Limitations

- **No street labels (glyphs)**: `planetiler --area=monaco` uses OpenMapTiles schema, which includes roads/POIs but not pre-rendered glyphs. The mobile app style strips glyph references to avoid 404s. Labels are a future enhancement.
- **Bali + Nusa Tenggara**: Geofabrik doesn't offer a Bali-only extract. The Nusa Tenggara region (~164 MB .pbf) covers Bali + West/East Nusa Tenggara — fine for MVP.
- **No automatic refresh**: Cron job is deferred. Re-run `refresh-osm.sh` manually when needed.
