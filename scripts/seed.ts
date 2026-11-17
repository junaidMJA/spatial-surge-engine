import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresDatabase } from '../src/config/database';

/** Loads db/seed.sql into the database (idempotent via ON CONFLICT). */
async function run(): Promise<void> {
  const database = new PostgresDatabase();
  const seedPath = join(__dirname, '..', 'db', 'seed.sql');
  const sql = await readFile(seedPath, 'utf8');

  await database.query(sql);

  // eslint-disable-next-line no-console
  console.log('[seed] complete');
}

run().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed', error);
  process.exit(1);
});