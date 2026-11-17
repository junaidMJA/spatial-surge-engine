import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { database } from './config/database';
import type { Database } from './config/database';
import { env } from './config/env';
import { SpatialModel } from './models/spatial.model';
import { SpatialService } from './services/spatial.service';
import { SurgeService } from './services/surge.service';
import { apiRoutes } from './routes/api.routes';
import { healthRoutes } from './routes/health.routes';
import type { ApiErrorBody } from './types';

export interface BuildAppOptions {
  database?: Database;
  model?: SpatialModel;
  spatialService?: SpatialService;
  surgeService?: SurgeService;
  logger?: boolean;
}

/**
 * Builds the Fastify application. Dependencies are injectable so the HTTP layer
 * can be unit-tested without a live database.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const db: Database = options.database ?? database;
  const model = options.model ?? new SpatialModel();
  const spatialService = options.spatialService ?? new SpatialService(db, model);
  const surgeService = options.surgeService ?? new SurgeService(db, model);

  const app = Fastify({
    logger:
      options.logger === undefined
        ? env.NODE_ENV === 'test'
          ? false
          : { level: env.LOG_LEVEL }
        : options.logger,
  });

  app.register(healthRoutes, { database: db });
  app.register(apiRoutes, { deps: { database: db, model, spatialService, surgeService } });

  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    const body: ApiErrorBody = {
      statusCode,
      code: error.code ?? 'INTERNAL_SERVER_ERROR',
      message: error.message ?? 'Internal server error',
    };
    app.log.error({ err: error }, 'unhandled error');
    return reply.code(statusCode).send(body);
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'graceful shutdown initiated');
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, host: env.HOST }, 'spatial-surge-engine listening');
}

if (require.main === module) {
  start().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('failed to start server', error);
    process.exit(1);
  });
}