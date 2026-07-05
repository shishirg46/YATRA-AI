-- hazard: independent spatial geometry for hazards
-- No FK to roads — hazards survive graph rebuilds.
-- Supports POINT, LINESTRING, and POLYGON geometries.
CREATE TABLE IF NOT EXISTS hazard (
    id              TEXT PRIMARY KEY,
    geometry        GEOMETRY(Geometry, 4326) NOT NULL,
    hazard_type     TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'unknown',
    confidence      DOUBLE PRECISION,
    source          TEXT,
    external_id     TEXT,
    valid_from      TIMESTAMPTZ,
    valid_to        TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hazard_geom ON hazard USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_hazard_type ON hazard (hazard_type);
CREATE INDEX IF NOT EXISTS idx_hazard_severity ON hazard (severity);
CREATE INDEX IF NOT EXISTS idx_hazard_source ON hazard (source);
CREATE INDEX IF NOT EXISTS idx_hazard_valid ON hazard (valid_from, valid_to);

-- segment_hazard: precomputed intersection table
-- Derived from ST_Intersects(hazard.geometry, route_segment.geometry).
-- Recomputable after any hazard or route_segment change.
CREATE TABLE IF NOT EXISTS segment_hazard (
    segment_id       TEXT NOT NULL REFERENCES route_segment(id) ON DELETE CASCADE,
    hazard_id        TEXT NOT NULL REFERENCES hazard(id) ON DELETE CASCADE,
    overlap_length_m DOUBLE PRECISION NOT NULL,
    start_offset_m   DOUBLE PRECISION NOT NULL,
    end_offset_m     DOUBLE PRECISION NOT NULL,
    affected_percent DOUBLE PRECISION NOT NULL,
    computed_at      TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (segment_id, hazard_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_segment ON segment_hazard (segment_id);
CREATE INDEX IF NOT EXISTS idx_sh_hazard ON segment_hazard (hazard_id);
