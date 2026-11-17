import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../config/database';
import { SpatialModel } from '../models/spatial.model';
import type { SpatialService } from '../services/spatial.service';
import type { SurgeService } from '../services/surge.service';
import type { OrderResponse } from '../types';
import { errorReply } from '../utils/http';

const pointSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

const createOrderSchema = z.object({
  tenantId: z.string().uuid(),
  location: pointSchema,
  basePrice: z.number().positive(),
});

export interface OrderControllerDeps {
  database: Database;
  model: SpatialModel;
  spatialService: SpatialService;
  surgeService: SurgeService;
}

/**
 * POST /api/v1/orders
 * Resolves the delivery zone, computes the live surge multiplier, persists the
 * order and its immutable surge snapshot atomically, then returns the pricing
 * breakdown.
 */
export const orderController = (deps: OrderControllerDeps): FastifyPluginAsync => async (app) => {
  app.post('/orders', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return errorReply(reply, 400, 'VALIDATION_ERROR', 'Invalid order payload', parsed.error.flatten());
    }
    const { tenantId, location, basePrice } = parsed.data;

    const zone = await deps.spatialService.resolveZoneForPoint(tenantId, location);
    if (zone === null) {
      return errorReply(reply, 422, 'NO_DELIVERY_ZONE', 'No active delivery zone covers the supplied coordinates');
    }

    const metrics = await deps.surgeService.getZoneMetrics(tenantId, zone.id);
    const pricing = deps.surgeService.priceOrder(basePrice, metrics);

    const created = await deps.database.withTransaction(async (tx) => {
      const order = await deps.model.createOrder(tx, {
        tenantId,
        longitude: location.longitude,
        latitude: location.latitude,
        zoneId: zone.id,
        basePrice,
        finalPrice: pricing.finalPrice,
        surgeMultiplier: pricing.multiplier,
        status: 'pending',
      });
      const snapshot = await deps.surgeService.recordSurgeSnapshot(tenantId, zone.id, order.id, metrics, tx);
      return { order, snapshot };
    });

    const response: OrderResponse = {
      order: created.order,
      zone,
      surge: {
        demand: metrics.activeOrders,
        supply: metrics.activeRiders,
        demandSupplyRatio: metrics.demandSupplyRatio,
        multiplier: pricing.multiplier,
        basePrice,
        finalPrice: pricing.finalPrice,
        snapshot: created.snapshot,
      },
    };

    return reply.code(201).send(response);
  });
};