import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Database } from '../config/database';
import { SpatialModel } from '../models/spatial.model';
import type { SpatialService } from '../services/spatial.service';
import type { SurgeService } from '../services/surge.service';
import { orderController } from '../controllers/order.controller';
import { riderController } from '../controllers/rider.controller';
import { zoneController } from '../controllers/zone.controller';

export interface ApiDeps {
  database: Database;
  model: SpatialModel;
  spatialService: SpatialService;
  surgeService: SurgeService;
}

/** Mounts the /api/v1 route surface. */
export const apiRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (
  app: FastifyInstance,
  opts,
) => {
  const { deps } = opts;

  await app.register(orderController(deps), { prefix: '/api/v1' });
  await app.register(zoneController(deps), { prefix: '/api/v1' });
  await app.register(riderController(deps.spatialService), { prefix: '/api/v1' });
};