import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../config/database';
import { SpatialModel } from '../models/spatial.model';
import type { SurgeService } from '../services/surge.service';
import type { ZoneSurgeResponse } from '../types';
import { errorReply } from '../utils/http';

const zoneParamsSchema = z.object({ zoneId: z.string().uuid() });
const tenantIdSchema = z.string().uuid();

export interface ZoneControllerDeps {
  database: Database;
  model: SpatialModel;
  surgeService: SurgeService;
}

function tenantIdFromRequest(request: FastifyRequest): string | undefined {
  const header = request.headers['x-tenant-id'];
  return Array.isArray(header) ? header[0] : header;
}

/**
 * GET /api/v1/zones/:zoneId/surge
 * Returns live demand/supply telemetry, the current surge multiplier and the
 * recent snapshot history for a single zone (tenant-scoped via x-tenant-id).
 */
export const zoneController = (deps: ZoneControllerDeps): FastifyPluginAsync => async (app) => {
  app.get('/zones/:zoneId/surge', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = zoneParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return errorReply(reply, 400, 'VALIDATION_ERROR', 'Invalid zone identifier', parsed.error.flatten());
    }

    const rawTenant = tenantIdFromRequest(request);
    const tenant = tenantIdSchema.safeParse(rawTenant);
    if (!tenant.success) {
      return errorReply(reply, 400, 'VALIDATION_ERROR', 'Missing or invalid x-tenant-id header');
    }

    const zone = await deps.model.getZoneById(deps.database, tenant.data, parsed.data.zoneId);
    if (zone === null) {
      return errorReply(reply, 404, 'ZONE_NOT_FOUND', 'Delivery zone not found for this tenant');
    }

    const metrics = await deps.surgeService.getZoneMetrics(tenant.data, zone.id);
    const history = await deps.model.getSurgeSnapshots(deps.database, tenant.data, zone.id, 20);

    const response: ZoneSurgeResponse = { zone, metrics, history };
    return reply.code(200).send(response);
  });
};