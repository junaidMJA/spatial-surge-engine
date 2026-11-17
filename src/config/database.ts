import { Pool } from 'pg';
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

/**
 * A minimal query surface shared by the node-postgres Pool, PoolClient and any
 * test double. Keeping this narrow means services and models can be unit-tested
 * without a live PostGIS instance.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** Transaction-capable database handle used by controller orchestration. */
export interface Database extends Queryable {
  withTransaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
}

function buildPoolConfig(): PoolConfig {
  if (env.DATABASE_URL) {
    return { connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX };
  }
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    max: env.DB_POOL_MAX,
  };
}

/** Application-wide connection pool (also used by the node migration runner). */
export const pool = new Pool(buildPoolConfig());

pool.on('error', (error: Error) => {
  // Idle-client errors (e.g. a Postgres restart) must not crash the process.
  // eslint-disable-next-line no-console
  console.error('[postgres] unexpected error on idle client', error);
});

/**
 * Thin wrapper around the shared pool that adds a transactional boundary for
 * multi-write workflows (order placement + immutable surge snapshot).
 */
export class PostgresDatabase implements Database {
  private readonly pgPool: Pool;

  constructor(pgPool: Pool = pool) {
    this.pgPool = pgPool;
  }

  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pgPool.query<R>(queryText, values);
  }

  async withTransaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Default database handle wired to the shared pool. */
export const database: Database = new PostgresDatabase();