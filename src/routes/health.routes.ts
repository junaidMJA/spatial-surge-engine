import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Database } from '../config/database';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  database: 'connected' | 'unreachable';
  postgisVersion: string | null;
  timestamp: string;
}

/**
 * GET /health
 * Verifies database connectivity and reports the active PostGIS extension.
 */
export const healthRoutes: FastifyPluginAsync<{ database: Database }> = async (
  app: FastifyInstance,
  opts,
) => {
  app.get('/health', async (_request, reply) => {
    try {
      await opts.database.query('SELECT 1');
      const versionResult = await opts.database.query('SELECT PostGIS_Version() AS postgis_version');
      const postgisRow = versionResult.rows[0] as { postgis_version: string } | undefined;

      const payload: HealthStatus = {
        status: 'ok',
        service: 'spatial-surge-engine',
        database: 'connected',
        postgisVersion: postgisRow?.postgis_version ?? null,
        timestamp: new Date().toISOString(),
      };
      return reply.code(200).send(payload);
    } catch (error) {
      app.log.error({ err: error }, 'database health check failed');
      const payload: HealthStatus = {
        status: 'degraded',
        service: 'spatial-surge-engine',
        database: 'unreachable',
        postgisVersion: null,
        timestamp: new Date().toISOString(),
      };
      return reply.code(503).send(payload);
    }
  });
};