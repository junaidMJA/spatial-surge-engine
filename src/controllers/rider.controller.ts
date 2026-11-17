import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SpatialService } from '../services/spatial.service';
import type { RiderLocationResponse } from '../types';
import { errorReply } from '../utils/http';

const pointSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

const riderLocationSchema = z.object({
  tenantId: z.string().uuid(),
  riderId: z.string().uuid(),
  location: pointSchema,
  isActive: z.boolean().default(true),
});

/**
 * POST /api/v1/riders/location
 * Upserts a rider's real-time coordinate and maps them to their current zone.
 */
export const riderController = (spatialService: SpatialService): FastifyPluginAsync => async (app) => {
  app.post('/riders/location', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = riderLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      return errorReply(reply, 400, 'VALIDATION_ERROR', 'Invalid rider location payload', parsed.error.flatten());
    }
    const { tenantId, riderId, location, isActive } = parsed.data;

    const update = await spatialService.updateRiderLocation(tenantId, riderId, location, isActive);

    const response: RiderLocationResponse = update;
    return reply.code(200).send(response);
  });
};