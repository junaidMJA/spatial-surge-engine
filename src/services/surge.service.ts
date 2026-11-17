import type { Queryable } from '../config/database';
import { env } from '../config/env';
import { SpatialModel } from '../models/spatial.model';
import type { SurgeMetrics, SurgeSnapshot } from '../types';

export interface SurgeTiers {
  baseMultiplier: number;
  lowThreshold: number;
  highThreshold: number;
  lowBoundMultiplier: number;
  highBoundMultiplier: number;
  maxMultiplier: number;
  aggressiveSlope: number;
}

export const DEFAULT_SURGE_TIERS: SurgeTiers = {
  baseMultiplier: 1.0,
  lowThreshold: 1.0,
  highThreshold: 2.0,
  lowBoundMultiplier: 1.2,
  highBoundMultiplier: 1.5,
  maxMultiplier: 3.0,
  aggressiveSlope: 0.5,
};

export function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer (received ${value})`);
  }
  return value;
}

/**
 * Demand/supply surge algorithm:
 *   - R = demand / supply
 *   - R <= 1.0                -> base multiplier (1.0x)
 *   - 1.0 < R <= 2.0          -> linear 1.2x .. 1.5x
 *   - R > 2.0                 -> aggressive scaling, capped at maxMultiplier
 *   - supply == 0 (with demand) -> maxMultiplier
 */
export function calculateSurgeMultiplier(
  demand: number,
  supply: number,
  tiers: SurgeTiers = DEFAULT_SURGE_TIERS,
): number {
  const activeOrders = assertNonNegativeInteger(demand, 'demand');
  const activeRiders = assertNonNegativeInteger(supply, 'supply');

  if (activeOrders === 0) {
    return tiers.baseMultiplier;
  }
  if (activeRiders === 0) {
    return tiers.maxMultiplier;
  }

  const ratio = activeOrders / activeRiders;

  if (ratio <= tiers.lowThreshold) {
    return tiers.baseMultiplier;
  }

  if (ratio <= tiers.highThreshold) {
    const progress = (ratio - tiers.lowThreshold) / (tiers.highThreshold - tiers.lowThreshold);
    return roundTo(tiers.lowBoundMultiplier + progress * (tiers.highBoundMultiplier - tiers.lowBoundMultiplier));
  }

  const aggressive = tiers.highBoundMultiplier + (ratio - tiers.highThreshold) * tiers.aggressiveSlope;
  return roundTo(Math.min(tiers.maxMultiplier, aggressive));
}

/**
 * Real-time surge telemetry and immutable snapshot persistence for a zone.
 */
export class SurgeService {
  private readonly windowMinutes: number;

  constructor(
    private readonly db: Queryable,
    private readonly model: SpatialModel = new SpatialModel(),
    private readonly tiers: SurgeTiers = DEFAULT_SURGE_TIERS,
    windowMinutes: number = env.SURGE_WINDOW_MINUTES,
  ) {
    this.windowMinutes = windowMinutes;
  }

  /** Computes live demand, supply, ratio and surge multiplier for a zone. */
  async getZoneMetrics(tenantId: string, zoneId: string): Promise<SurgeMetrics> {
    const demand = await this.model.countActiveOrdersInZone(this.db, tenantId, zoneId, this.windowMinutes);
    const supply = await this.model.countActiveRidersInZone(this.db, tenantId, zoneId);
    const demandSupplyRatio = supply === 0 ? null : roundTo(demand / supply, 4);
    const surgeMultiplier = calculateSurgeMultiplier(demand, supply, this.tiers);

    return {
      zoneId,
      tenantId,
      activeOrders: demand,
      activeRiders: supply,
      demandSupplyRatio,
      surgeMultiplier,
      windowMinutes: this.windowMinutes,
      calculatedAt: new Date(),
    };
  }

  /** Pure pricing calculation: final price = base price * surge multiplier. */
  priceOrder(basePrice: number, metrics: SurgeMetrics): { multiplier: number; finalPrice: number } {
    return {
      multiplier: metrics.surgeMultiplier,
      finalPrice: roundTo(basePrice * metrics.surgeMultiplier, 2),
    };
  }

  /**
   * Persists an immutable surge snapshot. A transaction client may be supplied
   * so the snapshot is written atomically with its order.
   */
  async recordSurgeSnapshot(
    tenantId: string,
    zoneId: string,
    orderId: string,
    metrics: SurgeMetrics,
    db: Queryable = this.db,
  ): Promise<SurgeSnapshot> {
    return this.model.insertSurgeSnapshot(db, {
      tenantId,
      zoneId,
      orderId,
      activeOrdersCount: metrics.activeOrders,
      activeRidersCount: metrics.activeRiders,
      demandSupplyRatio: metrics.demandSupplyRatio,
      surgeMultiplier: metrics.surgeMultiplier,
    });
  }
}