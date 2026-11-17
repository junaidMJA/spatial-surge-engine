-- =============================================================================
-- seed.sql
-- -----------------------------------------------------------------------------
-- Demo data for a San Francisco delivery network.
-- All geometries use SRID 4326 and (longitude, latitude) ordering.
-- Fixed UUIDs keep local development, demos and e2e tooling deterministic.
-- Idempotent via ON CONFLICT DO NOTHING.
-- =============================================================================

INSERT INTO tenants (id, name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Acme Delivery Co.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO delivery_zones (id, tenant_id, name, boundary) VALUES
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Downtown Core',
     ST_GeomFromText('POLYGON((-122.43 37.77, -122.40 37.77, -122.40 37.79, -122.43 37.79, -122.43 37.77))', 4326)),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Mission District',
     ST_GeomFromText('POLYGON((-122.43 37.75, -122.40 37.75, -122.40 37.765, -122.43 37.765, -122.43 37.75))', 4326)),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'SoMa',
     ST_GeomFromText('POLYGON((-122.40 37.77, -122.38 37.77, -122.38 37.79, -122.40 37.79, -122.40 37.77))', 4326))
ON CONFLICT (id) DO NOTHING;

-- Active riders positioned inside their home zones (rider 5 is inactive/outside).
INSERT INTO rider_locations (tenant_id, rider_id, current_location, is_active, zone_id) VALUES
    ('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
     ST_SetSRID(ST_MakePoint(-122.415, 37.78), 4326), TRUE,  '10000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
     ST_SetSRID(ST_MakePoint(-122.42, 37.785), 4326), TRUE,  '10000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003',
     ST_SetSRID(ST_MakePoint(-122.415, 37.758), 4326), TRUE, '10000000-0000-0000-0000-000000000002'),
    ('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000004',
     ST_SetSRID(ST_MakePoint(-122.39, 37.78), 4326), TRUE,  '10000000-0000-0000-0000-000000000003'),
    ('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000005',
     ST_SetSRID(ST_MakePoint(-124.00, 38.00), 4326), FALSE, NULL)
ON CONFLICT (tenant_id, rider_id) DO NOTHING;