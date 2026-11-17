import type { Queryable } from '../config/database';
import { SpatialModel } from '../models/spatial.model';
import type { Coordinates, DeliveryZone, RiderCandidate, RiderLocation } from '../types';

export interface RiderZoneUpdate {
  rider: RiderLocation;
  zone: DeliveryZone | null;
}

/**
 * High-level spatial operations: point-in-polygon zone resolution, radius /
 * nearest-neighbor rider discovery, and rider-to-zone telemetry mapping.
 */
export class SpatialService {
  constructor(
    private readonly db: Queryable,
    private readonly model: SpatialModel = new SpatialModel(),
  ) {}

  /** Resolves the active delivery zone covering a WGS-84 point (or null). */
  async resolveZoneForPoint(tenantId: string, coordinates: Coordinates): Promise<DeliveryZone | null> {
    return this.model.findZoneContainingPoint(
      this.db,
      tenantId,
      coordinates.longitude,
      coordinates.latitude,
    );
  }

  /** Returns active riders within `radiusMeters` of a point, nearest first. */
  async findRidersWithinRadius(
    tenantId: string,
    coordinates: Coordinates,
    radiusMeters: number,
    limit = 20,
  ): Promise<RiderCandidate[]> {
    return this.model.findRidersWithinRadius(
      this.db,
      tenantId,
      coordinates.longitude,
      coordinates.latitude,
      radiusMeters,
      limit,
    );
  }

  /** Returns the nearest active riders using the geography KNN operator. */
  async findNearestRiders(
    tenantId: string,
    coordinates: Coordinates,
    limit = 20,
  ): Promise<RiderCandidate[]> {
    return this.model.findNearestRiders(
      this.db,
      tenantId,
      coordinates.longitude,
      coordinates.latitude,
      limit,
    );
  }

  /**
   * Updates a rider's real-time coordinate and maps them to their current
   * geo-fence zone (null when they are outside every active zone).
   */
  async updateRiderLocation(
    tenantId: string,
    riderId: string,
    coordinates: Coordinates,
    isActive: boolean,
  ): Promise<RiderZoneUpdate> {
    const zone = await this.resolveZoneForPoint(tenantId, coordinates);
    const rider = await this.model.upsertRiderLocation(
      this.db,
      tenantId,
      riderId,
      coordinates.longitude,
      coordinates.latitude,
      isActive,
      zone?.id ?? null,
    );
    return { rider, zone };
  }
}