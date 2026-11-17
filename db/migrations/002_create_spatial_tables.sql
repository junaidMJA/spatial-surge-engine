-- =============================================================================
-- 002_create_spatial_tables.sql
-- -----------------------------------------------------------------------------
-- Operational tables for geo-fenced delivery zones, rider telemetry, orders and
-- the immutable surge-pricing audit ledger.
--
-- GIST indexes are created on every spatial column so that PostGIS predicates
-- (ST_Contains, ST_Intersects, ST_DWithin, <-> KNN) use the index instead of a
-- full sequential scan as the dataset grows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- delivery_zones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    boundary    GEOMETRY(Polygon, 4326) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_tenant
    ON delivery_zones (tenant_id);

-- Accelerates ST_Contains / ST_Intersects point-in-polygon resolution.
CREATE INDEX IF NOT EXISTS idx_delivery_zones_boundary_gist
    ON delivery_zones USING GIST (boundary);

-- Functional geography index used by meter-based distance predicates
-- (ST_DWithin(...::geography) and <-> KNN on geography).
CREATE INDEX IF NOT EXISTS idx_delivery_zones_boundary_geog_gist
    ON delivery_zones USING GIST ((boundary::geography));

-- -----------------------------------------------------------------------------
-- rider_locations (one row per rider -> upsert-based telemetry)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rider_locations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rider_id         UUID NOT NULL,
    current_location GEOMETRY(Point, 4326) NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    zone_id          UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_rider_locations_tenant
    ON rider_locations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rider_locations_active
    ON rider_locations (is_active);
CREATE INDEX IF NOT EXISTS idx_rider_locations_gist
    ON rider_locations USING GIST (current_location);
CREATE INDEX IF NOT EXISTS idx_rider_locations_geog_gist
    ON rider_locations USING GIST ((current_location::geography));

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    dropoff_location GEOMETRY(Point, 4326) NOT NULL,
    zone_id          UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
    base_price       NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
    final_price      NUMERIC(12, 2) CHECK (final_price >= 0),
    surge_multiplier NUMERIC(6, 3) NOT NULL DEFAULT 1.000,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'assigned', 'picked_up', 'delivered', 'cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders (zone_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_dropoff_gist ON orders USING GIST (dropoff_location);

-- -----------------------------------------------------------------------------
-- surge_snapshots -- immutable financial audit ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surge_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    zone_id             UUID NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
    order_id            UUID REFERENCES orders(id) ON DELETE SET NULL,
    active_orders_count INTEGER NOT NULL CHECK (active_orders_count >= 0),
    active_riders_count INTEGER NOT NULL CHECK (active_riders_count >= 0),
    demand_supply_ratio NUMERIC(12, 4),
    surge_multiplier    NUMERIC(6, 3) NOT NULL,
    snapshot_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surge_snapshots_zone_time
    ON surge_snapshots (zone_id, snapshot_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_surge_snapshots_tenant
    ON surge_snapshots (tenant_id);

-- The ledger is append-only: a historical pricing record can never be mutated.
-- (Deletes are intentionally allowed only via foreign-key CASCADE for tenant /
-- zone lifecycle management, and never via the public API.)
CREATE OR REPLACE FUNCTION prevent_surge_snapshot_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'surge_snapshots is an immutable audit ledger and cannot be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_surge_snapshots_immutable ON surge_snapshots;
CREATE TRIGGER trg_surge_snapshots_immutable
    BEFORE UPDATE ON surge_snapshots
    FOR EACH ROW EXECUTE FUNCTION prevent_surge_snapshot_update();