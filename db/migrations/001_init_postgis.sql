-- =============================================================================
-- 001_init_postgis.sql
-- -----------------------------------------------------------------------------
-- Enables the PostGIS spatial extension and prepares the database for the
-- row-level multi-tenancy model used across every operational table.
--
-- Idempotent: safe to re-run (CREATE EXTENSION ... IF NOT EXISTS).
--
-- Coordinate system: SRID 4326 (WGS 84). All PostGIS geometry is stored in
-- (longitude, latitude) order to match ST_MakePoint(lng, lat).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- pgcrypto is not required by modern PostgreSQL (gen_random_uuid() is built in
-- since PG 13) but keeps the schema portable to older installations.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Every operational table carries a `tenant_id` UUID so a single database can
-- serve many fully-isolated customers without cross-tenant data leakage.