/**
 * Domain types shared across the application. Coordinates in `Coordinates` and
 * every persisted geometry use SRID 4326 (WGS 84), i.e. `longitude` first.
 */

export type OrderStatus = 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'cancelled';

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface Tenant {
  id: string;
  name: string;
  createdAt: Date;
}

/** GeoJSON geometry serialized as a string (postgres ST_AsGeoJSON). */
export type GeoJson = string;

export interface DeliveryZone {
  id: string;
  tenantId: string;
  name: string;
  boundaryGeoJson: GeoJson;
  isActive: boolean;
  createdAt: Date;
}

export interface RiderLocation {
  id: string;
  tenantId: string;
  riderId: string;
  longitude: number;
  latitude: number;
  isActive: boolean;
  zoneId: string | null;
  updatedAt: Date;
}

export interface Order {
  id: string;
  tenantId: string;
  zoneId: string | null;
  dropoffLongitude: number;
  dropoffLatitude: number;
  basePrice: number;
  finalPrice: number | null;
  surgeMultiplier: number;
  status: OrderStatus;
  createdAt: Date;
}

export interface SurgeSnapshot {
  id: string;
  tenantId: string;
  zoneId: string;
  orderId: string | null;
  activeOrdersCount: number;
  activeRidersCount: number;
  demandSupplyRatio: number | null;
  surgeMultiplier: number;
  snapshotTimestamp: Date;
}

export interface SurgeMetrics {
  zoneId: string;
  tenantId: string;
  activeOrders: number;
  activeRiders: number;
  demandSupplyRatio: number | null;
  surgeMultiplier: number;
  windowMinutes: number;
  calculatedAt: Date;
}

export interface RiderCandidate {
  riderId: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  isActive: boolean;
}

export interface SurgeBreakdown {
  demand: number;
  supply: number;
  demandSupplyRatio: number | null;
  multiplier: number;
  basePrice: number;
  finalPrice: number;
  snapshot: SurgeSnapshot;
}

export interface OrderResponse {
  order: Order;
  zone: DeliveryZone | null;
  surge: SurgeBreakdown;
}

export interface ZoneSurgeResponse {
  zone: DeliveryZone;
  metrics: SurgeMetrics;
  history: SurgeSnapshot[];
}

export interface RiderLocationResponse {
  rider: RiderLocation;
  zone: DeliveryZone | null;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}