import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().min(1).default('spatial_engine'),

  DATABASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional(),
  ),

  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  SURGE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
});

export type Environment = z.infer<typeof EnvSchema>;

function loadEnv(): Environment {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: running with a broken configuration is worse than crashing.
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

/** Validated, typed application configuration (singleton). */
export const env: Environment = loadEnv();