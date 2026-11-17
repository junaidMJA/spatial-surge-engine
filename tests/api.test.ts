import { describe, expect, jest, test } from '@jest/globals';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database, Queryable } from '../src/config/database';
import type { SpatialModel } from '../src/models/spatial.model';
import { buildApp } from '../src/server';
import type { SpatialService } from '../src/services/spatial.service';
import type { SurgeService } from '../src/services/surge.service';
import type {
  DeliveryZone,
  Order,
  RiderLocation,
  SurgeMetrics,
  SurgeSnapshot,
} from '../src/types';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ZONE_ID = '10000000-0000-0000-0000-000000000001';
const RIDER_ID = '70000000-0000-0000-0000-000000000001';
const ORDER_ID = '90000000-0000-0000-0000-000000000001';
const SNAPSHOT_ID = 'a0000000-0000-0000-0000-000000000001';

function makeZone(): DeliveryZone {
  return {
    id: ZONE_ID,
    tenantId: TENANT_ID,
    name: 'Downtown Core',
    boundaryGeoJson:
      '{"type":"Polygon","coordinates":[[[-122.43,37.77],[-122.4,37.77],[-122.4,37.79],[-122.43,37.79],[-122.43,37.77]]]}',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeMetrics(): SurgeMetrics {
  return {
    zoneId: ZONE_ID,
    tenantId: TENANT_ID,
    activeOrders: 3,
    activeRiders: 2,
    demandSupplyRatio: 1.5,
    surgeMultiplier: 1.35,
    windowMinutes: 15,
    calculatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeSnapshot(): SurgeSnapshot {
  return {
    id: SNAPSHOT_ID,
    tenantId: TENANT_ID,
    zoneId: ZONE_ID,
    orderId: ORDER_ID,
    activeOrdersCount: 3,
    activeRidersCount: 2,
    demandSupplyRatio: 1.5,
    surgeMultiplier: 1.35,
    snapshotTimestamp: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeOrder(): Order {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    zoneId: ZONE_ID,
    dropoffLongitude: -122.415,
    dropoffLatitude: 37.78,
    basePrice: 25,
    finalPrice: 33.75,
    surgeMultiplier: 1.35,
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeRider(): RiderLocation {
  return {
    id: '80000000-0000-0000-0000-000000000001',
    tenantId: TENANT_ID,
    riderId: RIDER_ID,
    longitude: -122.415,
    latitude: 37.78,
    isActive: true,
    zoneId: ZONE_ID,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function toResult<R extends QueryResultRow>(rows: unknown[]): QueryResult<R> {
  return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

/** In-memory database double: health check lives here; writes go through fakes. */
class FakeDatabase implements Database {
  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: unknown[],
  ): Promise<QueryResult<R>> {
    if (text.includes('PostGIS_Version')) {
      return toResult<R>([{ postgis_version: '3.3 USE_GEOS=1' }]);
    }
    return toResult<R>([]);
  }

  async withTransaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    return work(this);
  }
}

const orderPayload = {
  tenantId: TENANT_ID,
  location: { longitude: -122.415, latitude: 37.78 },
  basePrice: 25,
};

describe('POST /api/v1/orders', () => {
  test('returns 201 with the full surge breakdown and persists atomically', async () => {
    const zone = makeZone();
    const metrics = makeMetrics();
    const snapshot = makeSnapshot();
    const order = makeOrder();

    const spatialService = {
      resolveZoneForPoint: jest.fn(async () => zone),
    } as unknown as SpatialService;
    const surgeService = {
      getZoneMetrics: jest.fn(async () => metrics),
      priceOrder: jest.fn((basePrice: number) => ({
        multiplier: metrics.surgeMultiplier,
        finalPrice: basePrice * metrics.surgeMultiplier,
      })),
      recordSurgeSnapshot: jest.fn(async () => snapshot),
    } as unknown as SurgeService;
    const model = {
      createOrder: jest.fn(async () => order),
    } as unknown as SpatialModel;

    const app = buildApp({ database: new FakeDatabase(), model, spatialService, surgeService, logger: false });

    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: orderPayload });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.order.id).toBe(ORDER_ID);
    expect(body.zone.id).toBe(ZONE_ID);
    expect(body.surge.multiplier).toBe(1.35);
    expect(body.surge.demand).toBe(3);
    expect(body.surge.supply).toBe(2);
    expect(body.surge.finalPrice).toBeCloseTo(33.75, 2);
    expect(body.surge.snapshot.id).toBe(SNAPSHOT_ID);
    await app.close();
  });

  test('returns 422 when no delivery zone covers the coordinates', async () => {
    const spatialService = {
      resolveZoneForPoint: jest.fn(async () => null),
    } as unknown as SpatialService;

    const app = buildApp({
      database: new FakeDatabase(),
      model: {} as unknown as SpatialModel,
      spatialService,
      surgeService: {} as unknown as SurgeService,
      logger: false,
    });

    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: orderPayload });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('NO_DELIVERY_ZONE');
    await app.close();
  });

  test('returns 400 for an invalid coordinate payload', async () => {
    const app = buildApp({
      database: new FakeDatabase(),
      model: {} as unknown as SpatialModel,
      spatialService: {} as unknown as SpatialService,
      surgeService: {} as unknown as SurgeService,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: { ...orderPayload, location: { longitude: -122.415, latitude: 91 } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});

describe('GET /api/v1/zones/:zoneId/surge', () => {
  test('returns 200 with live metrics and snapshot history', async () => {
    const zone = makeZone();
    const metrics = makeMetrics();
    const snapshot = makeSnapshot();

    const model = {
      getZoneById: jest.fn(async () => zone),
      getSurgeSnapshots: jest.fn(async () => [snapshot]),
    } as unknown as SpatialModel;
    const surgeService = {
      getZoneMetrics: jest.fn(async () => metrics),
    } as unknown as SurgeService;

    const app = buildApp({
      database: new FakeDatabase(),
      model,
      spatialService: {} as unknown as SpatialService,
      surgeService,
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/zones/${ZONE_ID}/surge`,
      headers: { 'x-tenant-id': TENANT_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.zone.id).toBe(ZONE_ID);
    expect(body.metrics.surgeMultiplier).toBe(1.35);
    expect(body.history).toHaveLength(1);
    await app.close();
  });

  test('returns 400 when the tenant header is missing', async () => {
    const app = buildApp({
      database: new FakeDatabase(),
      model: {} as unknown as SpatialModel,
      spatialService: {} as unknown as SpatialService,
      surgeService: {} as unknown as SurgeService,
      logger: false,
    });

    const response = await app.inject({ method: 'GET', url: `/api/v1/zones/${ZONE_ID}/surge` });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/v1/riders/location', () => {
  test('returns 200 with the rider and its mapped zone', async () => {
    const spatialService = {
      updateRiderLocation: jest.fn(async () => ({ rider: makeRider(), zone: makeZone() })),
    } as unknown as SpatialService;

    const app = buildApp({
      database: new FakeDatabase(),
      model: {} as unknown as SpatialModel,
      spatialService,
      surgeService: {} as unknown as SurgeService,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/riders/location',
      payload: {
        tenantId: TENANT_ID,
        riderId: RIDER_ID,
        location: { longitude: -122.415, latitude: 37.78 },
        isActive: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rider.riderId).toBe(RIDER_ID);
    expect(body.zone.id).toBe(ZONE_ID);
    await app.close();
  });
});

describe('GET /health', () => {
  test('returns 200 with database and PostGIS status', async () => {
    const app = buildApp({
      database: new FakeDatabase(),
      model: {} as unknown as SpatialModel,
      spatialService: {} as unknown as SpatialService,
      surgeService: {} as unknown as SurgeService,
      logger: false,
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().postgisVersion).toBe('3.3 USE_GEOS=1');
    await app.close();
  });
});