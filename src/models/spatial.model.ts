import type { QueryResultRow } from 'pg';
import type { Queryable } from '../config/database';
import type {
  DeliveryZone,
  Order,
  OrderStatus,
  RiderCandidate,
  RiderLocation,
  SurgeSnapshot,
} from '../types';

// -----------------------------------------------------------------------------
// Row shapes returned by node-postgres (snake_case SQL aliases -> camelCase DTOs)
// -----------------------------------------------------------------------------

interface ZoneRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  name: string;
  boundary_geojson: string;
  is_active: boolean;
  created_at: Date;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface OrderRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  zone_id: string | null;
  base_price: number;
  final_price: number | null;
  surge_multiplier: number;
  status: string;
  created_at: Date;
  lng: number;
  lat: number;
}

interface RiderRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  rider_id: string;
  is_active: boolean;
  zone_id: string | null;
  lng: number;
  lat: number;
  updated_at: Date;
}

interface NearbyRiderRow extends QueryResultRow {
  rider_id: string;
  is_active: boolean;
  lng: number;
  lat: number;
  distance_meters: number;
}

interface SnapshotRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  zone_id: string;
  order_id: string | null;
  active_orders_count: number;
  active_riders_count: number;
  demand_supply_ratio: number | null;
  surge_multiplier: number;
  snapshot_timestamp: Date;
}

export interface NewOrder {
  tenantId: string;
  longitude: number;
  latitude: number;
  zoneId: string;
  basePrice: number;
  finalPrice: number;
  surgeMultiplier: number;
  status: OrderStatus;
}

export interface NewSurgeSnapshot {
  tenantId: string;
  zoneId: string;
  orderId: string | null;
  activeOrdersCount: number;
  activeRidersCount: number;
  demandSupplyRatio: number | null;
  surgeMultiplier: number;
}

/**
 * Raw, parameterized spatial SQL. Every query uses PostGIS spatial functions and
 * takes advantage of the GIST indexes created in `002_create_spatial_tables.sql`.
 */
export class SpatialModel {
  /** Resolves the smallest active zone containing a WGS-84 point, if any. */
  async findZoneContainingPoint(
    db: Queryable,
    tenantId: string,
    longitude: number,
    latitude: number,
  ): Promise<DeliveryZone | null> {
    const result = await db.query<ZoneRow>(
      `SELECT z.id,
              z.tenant_id,
              z.name,
              ST_AsGeoJSON(z.boundary)::text AS boundary_geojson,
              z.is_active,
              z.created_at
         FROM delivery_zones z
        WHERE z.tenant_id = $1
          AND z.is_active = TRUE
          AND ST_Contains(z.boundary, ST_SetSRID(ST_MakePoint($2, $3), 4326))
        ORDER BY ST_Area(z.boundary) ASC
        LIMIT 1`,
      [tenantId, longitude, latitude],
    );
    const row = result.rows[0];
    return row ? this.mapZone(row) : null;
  }

  /** Counts active riders physically inside the zone boundary (ST_Contains). */
  async countActiveRidersInZone(db: Queryable, tenantId: string, zoneId: string): Promise<number> {
    const result = await db.query<CountRow>(
      `SELECT COUNT(*)::int AS count
         FROM rider_locations r
         JOIN delivery_zones z ON z.id = $2
        WHERE r.tenant_id = $1
          AND r.is_active = TRUE
          AND ST_Contains(z.boundary, r.current_location)`,
      [tenantId, zoneId],
    );
    return result.rows[0]?.count ?? 0;
  }

  /** Counts pending (unassigned) orders in the zone over the sampling window. */
  async countActiveOrdersInZone(
    db: Queryable,
    tenantId: string,
    zoneId: string,
    windowMinutes: number,
  ): Promise<number> {
    const result = await db.query<CountRow>(
      `SELECT COUNT(*)::int AS count
         FROM orders o
        WHERE o.tenant_id = $1
          AND o.zone_id = $2
          AND o.status = 'pending'
          AND o.created_at >= now() - ($3::int * interval '1 minute')`,
      [tenantId, zoneId, windowMinutes],
    );
    return result.rows[0]?.count ?? 0;
  }

  /** Finds active riders within a meter radius using ST_DWithin on geography. */
  async findRidersWithinRadius(
    db: Queryable,
    tenantId: string,
    longitude: number,
    latitude: number,
    radiusMeters: number,
    limit: number,
  ): Promise<RiderCandidate[]> {
    const result = await db.query<NearbyRiderRow>(
      `SELECT r.rider_id,
              r.is_active,
              ST_X(r.current_location)::float8 AS lng,
              ST_Y(r.current_location)::float8 AS lat,
              ST_Distance(r.current_location::geography,
                          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS distance_meters
         FROM rider_locations r
        WHERE r.tenant_id = $1
          AND r.is_active = TRUE
          AND ST_DWithin(r.current_location::geography,
                         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
        ORDER BY distance_meters ASC
        LIMIT $5`,
      [tenantId, longitude, latitude, radiusMeters, limit],
    );
    return result.rows.map((row) => this.mapNearbyRider(row));
  }

  /** Finds the nearest riders using the geography KNN operator `<->`. */
  async findNearestRiders(
    db: Queryable,
    tenantId: string,
    longitude: number,
    latitude: number,
    limit: number,
  ): Promise<RiderCandidate[]> {
    const result = await db.query<NearbyRiderRow>(
      `SELECT r.rider_id,
              r.is_active,
              ST_X(r.current_location)::float8 AS lng,
              ST_Y(r.current_location)::float8 AS lat,
              (r.current_location::geography <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS distance_meters
         FROM rider_locations r
        WHERE r.tenant_id = $1
          AND r.is_active = TRUE
        ORDER BY r.current_location::geography <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        LIMIT $4`,
      [tenantId, longitude, latitude, limit],
    );
    return result.rows.map((row) => this.mapNearbyRider(row));
  }

  /** Fetches a single zone scoped to a tenant. */
  async getZoneById(db: Queryable, tenantId: string, zoneId: string): Promise<DeliveryZone | null> {
    const result = await db.query<ZoneRow>(
      `SELECT z.id,
              z.tenant_id,
              z.name,
              ST_AsGeoJSON(z.boundary)::text AS boundary_geojson,
              z.is_active,
              z.created_at
         FROM delivery_zones z
        WHERE z.id = $1 AND z.tenant_id = $2`,
      [zoneId, tenantId],
    );
    const row = result.rows[0];
    return row ? this.mapZone(row) : null;
  }

  /** Upserts a rider's latest coordinate and maps them to their current zone. */
  async upsertRiderLocation(
    db: Queryable,
    tenantId: string,
    riderId: string,
    longitude: number,
    latitude: number,
    isActive: boolean,
    zoneId: string | null,
  ): Promise<RiderLocation> {
    const result = await db.query<RiderRow>(
      `INSERT INTO rider_locations (tenant_id, rider_id, current_location, is_active, zone_id)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
       ON CONFLICT (tenant_id, rider_id)
       DO UPDATE SET current_location = EXCLUDED.current_location,
                     is_active = EXCLUDED.is_active,
                     zone_id = EXCLUDED.zone_id,
                     updated_at = now()
       RETURNING id, tenant_id, rider_id, is_active, zone_id,
                 ST_X(current_location)::float8 AS lng,
                 ST_Y(current_location)::float8 AS lat,
                 updated_at`,
      [tenantId, riderId, longitude, latitude, isActive, zoneId],
    );
    return this.mapRider(result.rows[0]);
  }

  /** Persists an order together with its resolved zone and final pricing. */
  async createOrder(db: Queryable, input: NewOrder): Promise<Order> {
    const result = await db.query<OrderRow>(
      `INSERT INTO orders (tenant_id, dropoff_location, zone_id, base_price, final_price, surge_multiplier, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, $8)
       RETURNING id, tenant_id, zone_id,
                 base_price::float8 AS base_price,
                 final_price::float8 AS final_price,
                 surge_multiplier::float8 AS surge_multiplier,
                 status, created_at,
                 ST_X(dropoff_location)::float8 AS lng,
                 ST_Y(dropoff_location)::float8 AS lat`,
      [
        input.tenantId,
        input.longitude,
        input.latitude,
        input.zoneId,
        input.basePrice,
        input.finalPrice,
        input.surgeMultiplier,
        input.status,
      ],
    );
    return this.mapOrder(result.rows[0]);
  }

  /** Writes an immutable surge-pricing record to the audit ledger. */
  async insertSurgeSnapshot(db: Queryable, input: NewSurgeSnapshot): Promise<SurgeSnapshot> {
    const result = await db.query<SnapshotRow>(
      `INSERT INTO surge_snapshots
         (tenant_id, zone_id, order_id, active_orders_count, active_riders_count, demand_supply_ratio, surge_multiplier)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id, zone_id, order_id,
                 active_orders_count, active_riders_count,
                 demand_supply_ratio::float8 AS demand_supply_ratio,
                 surge_multiplier::float8 AS surge_multiplier,
                 snapshot_timestamp`,
      [
        input.tenantId,
        input.zoneId,
        input.orderId,
        input.activeOrdersCount,
        input.activeRidersCount,
        input.demandSupplyRatio,
        input.surgeMultiplier,
      ],
    );
    return this.mapSnapshot(result.rows[0]);
  }

  /** Returns recent snapshots for a zone (newest first). */
  async getSurgeSnapshots(
    db: Queryable,
    tenantId: string,
    zoneId: string,
    limit: number,
  ): Promise<SurgeSnapshot[]> {
    const result = await db.query<SnapshotRow>(
      `SELECT id, tenant_id, zone_id, order_id,
              active_orders_count, active_riders_count,
              demand_supply_ratio::float8 AS demand_supply_ratio,
              surge_multiplier::float8 AS surge_multiplier,
              snapshot_timestamp
         FROM surge_snapshots
        WHERE tenant_id = $1 AND zone_id = $2
        ORDER BY snapshot_timestamp DESC
        LIMIT $3`,
      [tenantId, zoneId, limit],
    );
    return result.rows.map((row) => this.mapSnapshot(row));
  }

  // ---------------------------------------------------------------------------
  // Row mappers
  // ---------------------------------------------------------------------------

  private mapZone(row: ZoneRow): DeliveryZone {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      boundaryGeoJson: row.boundary_geojson,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }

  private mapRider(row: RiderRow): RiderLocation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      riderId: row.rider_id,
      longitude: row.lng,
      latitude: row.lat,
      isActive: row.is_active,
      zoneId: row.zone_id,
      updatedAt: row.updated_at,
    };
  }

  private mapNearbyRider(row: NearbyRiderRow): RiderCandidate {
    return {
      riderId: row.rider_id,
      longitude: row.lng,
      latitude: row.lat,
      distanceMeters: row.distance_meters,
      isActive: row.is_active,
    };
  }

  private mapOrder(row: OrderRow): Order {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      zoneId: row.zone_id,
      dropoffLongitude: row.lng,
      dropoffLatitude: row.lat,
      basePrice: row.base_price,
      finalPrice: row.final_price,
      surgeMultiplier: row.surge_multiplier,
      status: row.status as OrderStatus,
      createdAt: row.created_at,
    };
  }

  private mapSnapshot(row: SnapshotRow): SurgeSnapshot {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      zoneId: row.zone_id,
      orderId: row.order_id,
      activeOrdersCount: row.active_orders_count,
      activeRidersCount: row.active_riders_count,
      demandSupplyRatio: row.demand_supply_ratio,
      surgeMultiplier: row.surge_multiplier,
      snapshotTimestamp: row.snapshot_timestamp,
    };
  }
}