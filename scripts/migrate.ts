import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresDatabase } from '../src/config/database';

/**
 * Applies every SQL file in db/migrations (in lexicographic order) using the
 * simple query protocol. Migration files are idempotent by design.
 */
async function run(): Promise<void> {
  const database = new PostgresDatabase();
  const migrationsDir = join(__dirname, '..', 'db', 'migrations');

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  // eslint-disable-next-line no-console
  console.log(`[migrate] applying ${files.length} migration(s) from ${migrationsDir}`);

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await database.query(sql);
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied ${file}`);
  }

  // eslint-disable-next-line no-console
  console.log('[migrate] complete');
}

run().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed', error);
  process.exit(1);
});