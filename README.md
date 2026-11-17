# Geo-Fenced Spatial Delivery & Dynamic Surge Pricing Engine

A production-grade reference implementation of a real-time delivery platform built on
**PostgreSQL + PostGIS**, demonstrating spatial indexing (`GIST`), multi-tenancy,
demand/supply analytics and high-performance **Node.js / TypeScript** architecture.

<p align="left">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white">
  <img alt="PostGIS" src="https://img.shields.io/badge/PostGIS-3.3-4EAA25?logo=mapbox&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-4-000000?logo=fastify&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg">
</p>

---

## Overview

Delivery marketplaces must answer three questions in **milliseconds, at scale**:

1. Which geo-fenced delivery zone does a customer's coordinate fall inside?
2. What is the real-time demand/supply imbalance inside that zone?
3. What price should the customer pay, and how is that price **provably auditable**?

This repository answers all three with a spatial database core, an algorithmic surge
engine, and an immutable pricing ledger.

---

## Architecture

```mermaid
flowchart LR
    A[Client Request\nGeoJSON / Coordinates] --> B[Fastify API Layer\nZod validation]
    B --> C[SpatialService\nPoint-in-Polygon]
    C --> D[(PostGIS\nST_Contains + GIST)]
    B --> E[SurgeService\nDemand/Supply Engine]
    E --> F[Immutable Snapshot Ledger\nsurge_snapshots]
    D --> G[Zone Resolution]
    E --> G
    F --> H[Response\nPricing Breakdown]
    G --> H
```

### Entity Relationship Diagram

```mermaid
erDiagram
    TENANTS ||--o{ DELIVERY_ZONES : owns
    TENANTS ||--o{ RIDER_LOCATIONS : owns
    TENANTS ||--o{ ORDERS : places
    TENANTS ||--o{ SURGE_SNAPSHOTS : audits

    DELIVERY_ZONES ||--o{ RIDER_LOCATIONS : "contains rider"
    DELIVERY_ZONES ||--o{ ORDERS : "serves order"
    DELIVERY_ZONES ||--o{ SURGE_SNAPSHOTS : "prices history"

    ORDERS ||--o{ SURGE_SNAPSHOTS : "documents"

    DELIVERY_ZONES {
        uuid id PK
        uuid tenant_id FK
        text name
        geometry boundary "Polygon, 4326"
        boolean is_active
    }
    RIDER_LOCATIONS {
        uuid id PK
        uuid tenant_id FK
        uuid rider_id
        geometry current_location "Point, 4326"
        boolean is_active
        uuid zone_id FK
    }
    ORDERS {
        uuid id PK
        uuid tenant_id FK
        geometry dropoff_location "Point, 4326"
        uuid zone_id FK
        numeric base_price
        numeric final_price
        numeric surge_multiplier
        text status
    }
    SURGE_SNAPSHOTS {
        uuid id PK
        uuid tenant_id FK
        uuid zone_id FK
        uuid order_id FK
        int active_orders_count
        int active_riders_count
        numeric demand_supply_ratio
        numeric surge_multiplier
        timestamptz snapshot_timestamp
    }
```

---

## Core Engineering Highlights

### 1. GIST Spatial Indexing for O(1)-ish Geometric Lookups

Every spatial column carries a `GIST` index (`boundary`, `current_location`,
`dropoff_location`) plus **functional geography** indexes
(`((boundary::geography))`) for meter-accurate distance work. Point-in-polygon
resolution uses `ST_Contains(z.boundary, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))`
and rider discovery uses `ST_DWithin(...::geography, ..., $radius)` and the `<->` KNN
operator. Without these indexes PostGIS would degrade to a full table scan; with them,
lookups stay fast as zone/rider counts scale into the millions.

### 2. Immutable Financial Ledger

Every surge calculation writes a row to `surge_snapshots` in the **same transaction**
as the order. A database trigger blocks `UPDATE` on the ledger, making historical
pricing records append-only and guaranteeing receipt-level auditability.

### 3. Multi-Tenant Isolation

Every operational table carries a `tenant_id UUID`. Requests are always scoped by
tenant (body for writes, `x-tenant-id` header for reads), preventing cross-tenant
data leakage in a single shared cluster.

### 4. Safe, Parameterized Spatial SQL

All queries are fully parameterized (no string interpolation), eliminating SQL
injection and guaranteeing correct SRID 4326 handling.

---

## Quickstart

```bash
# 1. Copy the environment template (optional — sane defaults are provided)
cp .env.example .env

# 2. Build and launch PostGIS + the API
docker compose up --build

# 3. Verify the health of both services
curl http://localhost:3000/health

# 4. (Optional) re-apply migrations / load demo seed data onto an existing volume
make migrate
make seed
```

On the very first boot, the PostGIS container auto-applies the migrations and seed
data from `db/migrations` and `db/seed.sql` via `/docker-entrypoint-initdb.d`.

### Building & running the Docker image (manual)

`docker compose up --build` builds the API image from the multi-stage `Dockerfile`
and tags it `spatial-surge-engine-api` (Compose's default `<project>-<service>` name).
To build, tag, and run the image yourself without Compose:

```bash
# Build the image directly
docker build -t spatial-surge-engine:latest .

# Run it against an already-running PostGIS
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/spatial_engine \
  spatial-surge-engine:latest
```

The image is built from source rather than pulled from a public registry, which keeps
the build reproducible and fully dependency-auditable.

### Publishing the image to a registry (optional)

To share the image on Docker Hub or GitHub Container Registry (GHCR):

> **Automated path:** the `.github/workflows/docker-publish.yml` workflow builds and
> pushes to GHCR automatically whenever you push a `v*` tag (or trigger it manually
> from the Actions tab) — no local Docker required.

```bash
# Docker Hub
docker tag spatial-surge-engine:latest your-dockerhub-user/spatial-surge-engine:1.0.0
docker login
docker push your-dockerhub-user/spatial-surge-engine:1.0.0

# GitHub Container Registry (GHCR)
docker tag spatial-surge-engine:latest ghcr.io/your-github-user/spatial-surge-engine:1.0.0
echo "$GITHUB_TOKEN" | docker login ghcr.io -u your-github-user --password-stdin
docker push ghcr.io/your-github-user/spatial-surge-engine:1.0.0
```

Run the test suite:

```bash
npm install        # once
make test          # or: npm test
```

The pure surge-math and API tests always run; the PostGIS integration tests
automatically skip when no live PostGIS instance is reachable (see
[Troubleshooting](#troubleshooting) if they skip while PostGIS is running).

### Local development (no Docker for the API)

```bash
npm install
npm run migrate            # applies migrations to DATABASE_URL (defaults to localhost)
npm run seed
npm run dev                # tsx watch-mode server on :3000
```

---

## API Reference

### `POST /api/v1/orders` — place an order

```http
POST /api/v1/orders HTTP/1.1
Content-Type: application/json
```

**Request body**

```json
{
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "location": { "longitude": -122.415, "latitude": 37.78 },
  "basePrice": 25.0
}
```

**201 response**

```json
{
  "order": {
    "id": "66a6c4b0-...",
    "tenantId": "00000000-0000-0000-0000-000000000001",
    "zoneId": "10000000-0000-0000-0000-000000000001",
    "dropoffLongitude": -122.415,
    "dropoffLatitude": 37.78,
    "basePrice": 25,
    "finalPrice": 33.75,
    "surgeMultiplier": 1.35,
    "status": "pending",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "zone": {
    "id": "10000000-0000-0000-0000-000000000001",
    "name": "Downtown Core",
    "boundaryGeoJson": "{...Polygon GeoJSON...}",
    "isActive": true
  },
  "surge": {
    "demand": 3,
    "supply": 2,
    "demandSupplyRatio": 1.5,
    "multiplier": 1.35,
    "basePrice": 25,
    "finalPrice": 33.75,
    "snapshot": {
      "id": "a0000000-0000-0000-0000-000000000001",
      "activeOrdersCount": 3,
      "activeRidersCount": 2,
      "surgeMultiplier": 1.35,
      "snapshotTimestamp": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

### `GET /api/v1/zones/:zoneId/surge` — live telemetry

```http
GET /api/v1/zones/10000000-0000-0000-0000-000000000001/surge HTTP/1.1
x-tenant-id: 00000000-0000-0000-0000-000000000001
```

Returns `zone`, `metrics` (live `activeOrders`, `activeRiders`,
`demandSupplyRatio`, `surgeMultiplier`) and `history` (recent immutable snapshots).

### `POST /api/v1/riders/location` — update rider telemetry

```json
{
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "riderId": "70000000-0000-0000-0000-000000000001",
  "location": { "longitude": -122.415, "latitude": 37.78 },
  "isActive": true
}
```

Returns the updated rider and its resolved geo-fence `zone` (or `null` if outside
every zone).

### `GET /health` — liveness + PostGIS status

```json
{
  "status": "ok",
  "service": "spatial-surge-engine",
  "database": "connected",
  "postgisVersion": "3.3 USE_GEOS=1 USE_PROJ=...",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

## Environment Variables

| Variable                | Default         | Description                                          |
| ----------------------- | --------------- | ---------------------------------------------------- |
| `NODE_ENV`              | `development`   | `development` / `test` / `production`                |
| `HOST` / `PORT`         | `0.0.0.0` / `3000` | API bind host/port                                 |
| `LOG_LEVEL`             | `info`          | Pino log level                                       |
| `POSTGRES_USER/PASSWORD/DB` | `postgres`/`postgres`/`spatial_engine` | Compose db bootstrap |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | `localhost`/`5432`/... | Node app connection |
| `DATABASE_URL`          | `postgres://postgres:postgres@localhost:5432/spatial_engine` | Overrides `DB_*` |
| `DB_POOL_MAX`           | `10`            | Connection pool size                                 |
| `SURGE_WINDOW_MINUTES`  | `15`            | Demand sampling window (minutes)                     |

---

## Project Structure

```text
spatial-surge-engine/
├── .github/workflows/ci.yml      # lint + typecheck + migration + tests
├── db/
│   ├── migrations/
│   │   001_init_postgis.sql
│   │   002_create_spatial_tables.sql
│   └── seed.sql
├── src/
│   ├── config/                   # env (Zod) + pg pool / transaction wrapper
│   ├── models/spatial.model.ts   # parameterized PostGIS SQL
│   ├── services/                 # spatial.service, surge.service
│   ├── controllers/              # order, zone, rider
│   ├── routes/                   # api.routes, health.routes
│   ├── types/                    # domain interfaces
│   └── server.ts                 # composition root + Fastify bootstrap
├── tests/                        # spatial.test.ts, api.test.ts
├── scripts/                      # migrate.ts, seed.ts
├── Dockerfile
├── docker-compose.yml
└── Makefile
```

---

## Troubleshooting

### `database "spatial_engine" does not exist` / PostGIS integration tests skip

If `npm test` reports that the `spatial_engine` database does not exist (or
`function postgis_full_version() does not exist`), a **second local PostgreSQL** is
usually already bound to port `5432`. The Docker image and the API are unaffected —
the API talks to the PostGIS container over the internal Compose network
(`postgres:5432`) — but a host-side `npm test` reaches whatever is listening on
`localhost:5432` first.

Free the port to let the containerized PostGIS own `5432`, e.g. stop the local server:

```bash
# Windows (run as administrator) — adjust the service name to match your install
net stop postgresql-x64-16
```

Alternatively, remap the Compose host port and point `DATABASE_URL` at it:

```dotenv
# .env
DB_PORT=5433
DATABASE_URL=postgres://postgres:postgres@localhost:5433/spatial_engine
```

then re-create the stack and re-run the suite:

```bash
docker compose up -d
npm test
```

### Port 5432 already in use (container won't bind)

Same root cause as above. Stop the local PostgreSQL service, or change the host port
via `DB_PORT` in `.env` and re-create the stack. In CI this never happens — the
`ci.yml` job provisions its own PostGIS service container.

---

## License

Released under the [MIT License](LICENSE).