import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { PostgresDatabase } from '../src/config/database';
import { SpatialModel } from '../src/models/spatial.model';
import { calculateSurgeMultiplier, DEFAULT_SURGE_TIERS } from '../src/services/surge.service';

// -----------------------------------------------------------------------------
// Pure unit tests -- no database required
// -----------------------------------------------------------------------------

describe('surge multiplier algorithm', () => {
  test('returns the base multiplier when R <= 1.0', () => {
    expect(calculateSurgeMultiplier(0, 5)).toBe(1.0);
    expect(calculateSurgeMultiplier(2, 2)).toBe(1.0);
    expect(calculateSurgeMultiplier(1, 3)).toBe(1.0);
  });

  test('scales linearly between 1.2x and 1.5x for 1.0 < R <= 2.0', () => {
    expect(calculateSurgeMultiplier(3, 2)).toBeCloseTo(1.35, 2); // R = 1.5
    expect(calculateSurgeMultiplier(4, 2)).toBeCloseTo(1.5, 2); // R = 2.0
  });

  test('applies aggressive scaling beyond R = 2.0 and caps at the maximum', () => {
    expect(calculateSurgeMultiplier(5, 2)).toBeCloseTo(1.75, 2); // R = 2.5
    expect(calculateSurgeMultiplier(10, 2)).toBe(3.0); // capped
    expect(calculateSurgeMultiplier(100, 2)).toBe(3.0); // capped
  });

  test('returns the maximum multiplier when supply is zero and demand exists', () => {
    expect(calculateSurgeMultiplier(3, 0)).toBe(DEFAULT_SURGE_TIERS.maxMultiplier);
    expect(calculateSurgeMultiplier(0, 0)).toBe(1.0);
  });

  test('rejects negative demand or supply', () => {
    expect(() => calculateSurgeMultiplier(-1, 2)).toThrow(RangeError);
    expect(() => calculateSurgeMultiplier(1, -1)).toThrow(RangeError);
  });
});

// -----------------------------------------------------------------------------
// PostGIS integration -- automatically skipped when no PostGIS is reachable
// -----------------------------------------------------------------------------

describe('PostGIS spatial integration (requires live PostGIS)', () => {
  const database = new PostgresDatabase();
  const model = new SpatialModel();

  const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const zoneId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const riderId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  let available = false;

  beforeAll(async () => {
    try {
      await database.query('SELECT PostGIS_Version()');
      available = true;

      // Tenant-scoped fixtures; cascade deletes clean up everything below.
      await database.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
      await database.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
        tenantId,
        'Integration Tenant',
      ]);
      await database.query(
        `INSERT INTO delivery_zones (id, tenant_id, name, boundary)
         VALUES ($1, $2, 'Test Zone',
                 ST_GeomFromText('POLYGON((-122.43 37.77, -122.40 37.77, -122.40 37.79, -122.43 37.79, -122.43 37.77))', 4326))`,
        [zoneId, tenantId],
      );
      await database.query(
        `INSERT INTO rider_locations (tenant_id, rider_id, current_location, is_active, zone_id)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint(-122.415, 37.78), 4326), TRUE, $3)`,
        [tenantId, riderId, zoneId],
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('PostGIS unavailable; skipping spatial integration tests', error);
      available = false;
    }
  });

  afterAll(async () => {
    if (!available) return;
    await database.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
  });

  test('resolves the zone for a point inside the polygon boundary', async () => {
    if (!available) return;
    const zone = await model.findZoneContainingPoint(database, tenantId, -122.415, 37.78);
    expect(zone).not.toBeNull();
    expect(zone?.id).toBe(zoneId);
  });

  test('returns null for a point outside the polygon boundary', async () => {
    if (!available) return;
    const zone = await model.findZoneContainingPoint(database, tenantId, -122.50, 37.80);
    expect(zone).toBeNull();
  });

  test('finds the seeded rider within a radius using ST_DWithin', async () => {
    if (!available) return;
    const riders = await model.findRidersWithinRadius(database, tenantId, -122.416, 37.7805, 500, 10);
    expect(riders.some((rider) => rider.riderId === riderId)).toBe(true);
  });

  test('counts active riders physically inside the zone via ST_Contains', async () => {
    if (!available) return;
    const count = await model.countActiveRidersInZone(database, tenantId, zoneId);
    expect(count).toBe(1);
  });
});