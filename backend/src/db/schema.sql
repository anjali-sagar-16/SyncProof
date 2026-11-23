-- ==============================================================================
-- SyncProof Database Schema
-- Offline-first equipment inspection with optimistic concurrency & audit logs
-- ==============================================================================

-- 1. Users Table (Technicians and Supervisors)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('technician', 'supervisor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Equipment Table
CREATE TABLE IF NOT EXISTS equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    location VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'decommissioned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Inspections Table (Core Entity with Version Counter for OCC)
CREATE TABLE IF NOT EXISTS inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    inspector_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'completed' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
    overall_result VARCHAR(20) CHECK (overall_result IN ('pass', 'fail', 'warning')),
    readings JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    has_pending_conflict BOOLEAN NOT NULL DEFAULT FALSE,
    last_modified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Sync Mutations Table (Idempotency and Duplicate Protection)
CREATE TABLE IF NOT EXISTS sync_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_mutation_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'inspection',
    entity_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('applied', 'merged', 'conflicted', 'rejected')),
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Inspection Conflicts Table (Human-in-the-loop Review Queue)
CREATE TABLE IF NOT EXISTS inspection_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    client_mutation_id UUID NOT NULL,
    technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_version INTEGER NOT NULL CHECK (base_version >= 1),
    server_version INTEGER NOT NULL CHECK (server_version >= 1),
    base_state JSONB NOT NULL,
    server_state JSONB NOT NULL,
    client_state JSONB NOT NULL,
    conflicting_fields JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Inspection Audit Logs Table (Immutable History of Changes & Conflict Resolutions)
CREATE TABLE IF NOT EXISTS inspection_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(30) NOT NULL CHECK (action IN ('created', 'updated', 'auto_merged', 'conflict_flagged', 'conflict_resolved')),
    version INTEGER NOT NULL CHECK (version >= 1),
    previous_state JSONB,
    new_state JSONB,
    changed_fields JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- Indexes for Fast Lookups and Referential Integrity
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_inspections_equipment_id ON inspections(equipment_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector_id ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_has_pending_conflict ON inspections(has_pending_conflict);
CREATE INDEX IF NOT EXISTS idx_sync_mutations_client_mutation_id ON sync_mutations(client_mutation_id);
CREATE INDEX IF NOT EXISTS idx_sync_mutations_user_id ON sync_mutations(user_id);
CREATE INDEX IF NOT EXISTS idx_inspection_conflicts_inspection_id ON inspection_conflicts(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_conflicts_status ON inspection_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_inspection_audit_logs_inspection_id ON inspection_audit_logs(inspection_id);
