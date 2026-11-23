# SyncProof: Offline-First Equipment Inspection Management Platform

SyncProof is an enterprise-grade, offline-first equipment inspection platform built with **React 18**, **Node.js/Express**, and **PostgreSQL**. Designed for field technicians operating in remote industrial environments with intermittent or zero internet connectivity, SyncProof guarantees complete operational continuity, strict data integrity via **Optimistic Concurrency Control (OCC)**, **three-way field-level auto-merging**, **idempotent synchronization**, and **human-in-the-loop supervisor conflict arbitration**.

---

## 1. System Architecture

```
                   +---------------------------------------------+
                   |           Field Technician Browser          |
                   |  (React 18 + Vite + Lucide UI + IndexedDB)  |
                   +---------------------------------------------+
                                     |         ^
       Offline Outbox Mutations      |         | Cached Records & Status
                                     v         |
                   +---------------------------------------------+
                   |      Browser Storage Engine (IndexedDB)     |
                   |  - Equipment Store                          |
                   |  - Inspections Store                        |
                   |  - Outbox Mutation Queue (status tracking)  |
                   +---------------------------------------------+
                                     |
               Auto-Sync on Reconnect | (Batch POST /api/sync)
                                     v
                   +---------------------------------------------+
                   |          SyncProof Backend REST API         |
                   |        (Node.js + Express + JWT/RBAC)       |
                   +---------------------------------------------+
                                     |
                   +---------------------------------------------+
                   |                 Sync Engine                 |
                   |  - Idempotency Barrier (sync_mutations)     |
                   |  - Optimistic Concurrency Control (OCC)     |
                   |  - Three-Way Auto-Merge Service             |
                   |  - Collision Detector                       |
                   +---------------------------------------------+
                         /                               \
         Clean / Disjoint Merge                   Overlapping Collision
                       /                                   \
                      v                                     v
         +------------------------+             +------------------------+
         | Direct Apply to Record |             | Flag Pending Conflict  |
         | Version Increment (N+1)|             | (inspection_conflicts) |
         | Audit Log Written      |             +------------------------+
         +------------------------+                         |
                                                            v
                                                +------------------------+
                                                |   Supervisor Review    |
                                                |   & Arbitration UI     |
                                                |  (Keep Server / Client |
                                                |   / Custom Merge)      |
                                                +------------------------+
                                                            |
                                                            v
                                                +------------------------+
                                                | Resolved Inspection    |
                                                | Version Increment (N+1)|
                                                | Immutable Audit Log    |
                                                +------------------------+
```

---

## 2. Tech Stack

- **Frontend**:
  - React 18, Vite 6, Modern JavaScript (ESM)
  - Persistent Local Storage: IndexedDB (Database Version 2 with persistent Outbox)
  - UI Icons & Styling: Lucide React, Custom Responsive Industrial CSS System
  - Testing: Node.js Test Runner with `fake-indexeddb`
- **Backend**:
  - Node.js (v20+), Express 5
  - Authentication: JWT (JSON Web Tokens) with 8-hour expiry
  - Authorization: Role-Based Access Control (`technician`, `supervisor`)
  - Password Security: `bcryptjs` (10 salt rounds)
  - Testing: Node.js Test Runner (`node:test`) + `supertest`
- **Database**:
  - PostgreSQL 16 (Relational Schema, JSONB, Constraints, Foreign Keys, UUIDs)
  - **Dual-Mode Adapter**: Automatically detects external PostgreSQL (`pg.Pool`), falling back to embedded WebAssembly PostgreSQL (`@electric-sql/pglite`) with persistent disk storage in dev environments.

---

## 3. Core Database Schema

| Table Name | Description | Key Features & Constraints |
| :--- | :--- | :--- |
| **`users`** | Technicians & supervisors | UUID primary key, unique email, bcrypt hash, role CHECK (`'technician'`, `'supervisor'`) |
| **`equipment`** | Industrial machinery catalog | UUID primary key, unique `code`, status CHECK (`'active'`, `'maintenance'`, `'decommissioned'`) |
| **`inspections`** | Inspection records with OCC | UUID primary key, FKs to `equipment` and `users`, `version` (OCC integer), JSONB `readings`, `has_pending_conflict` flag |
| **`sync_mutations`** | Idempotency & replay barrier | UUID primary key, unique `client_mutation_id`, action CHECK, status CHECK, JSONB response cache |
| **`inspection_conflicts`**| Supervisor arbitration queue | UUID primary key, FK to `inspections` and `users`, stores `base_state`, `server_state`, `client_state`, and `conflicting_fields` JSONB |
| **`inspection_audit_logs`**| Immutable change log | UUID primary key, FK to `inspections`, action CHECK (`'created'`, `'updated'`, `'auto_merged'`, `'conflict_flagged'`, `'conflict_resolved'`), version tracker |

---

## 4. REST API Endpoint Reference

### Authentication
- `POST /api/auth/login`: Authenticate user credentials, returns JWT token & user profile.
- `GET /api/auth/me`: Validate JWT token and retrieve current user session profile.
- `GET /api/auth/technician-test`: RBAC test route accessible by technicians and supervisors.
- `GET /api/auth/supervisor-test`: RBAC test route strictly restricted to supervisors.

### Equipment Management
- `GET /api/equipment`: List all equipment records with optional `search` and `status` query filters.
- `GET /api/equipment/:id`: Retrieve equipment specifications and recent inspection history.

### Inspection Management & OCC
- `GET /api/inspections`: List inspections with optional filters (`equipment_id`, `inspector_id`, `status`, `has_pending_conflict`).
- `GET /api/inspections/:id`: Retrieve single inspection detail with full chronological audit trail.
- `POST /api/inspections`: Create new inspection record (initializes OCC `version: 1`, writes `created` audit record).
- `PUT /api/inspections/:id`: Update inspection using Optimistic Concurrency Control. Requires `baseVersion`. Rejects with HTTP 409 Conflict if record was modified concurrently.

### Synchronization Engine
- `POST /api/sync`: Batch processes queued client mutations:
  - Validates `clientMutationId` UUID.
  - Checks idempotency table: replayed requests return original response without re-processing.
  - Three-way auto-merging: disjoint edits merge cleanly and advance version.
  - Collision detection: overlapping field edits flag inspection with `has_pending_conflict: true` and insert into `inspection_conflicts`.

### Conflict Review & Arbitration (Supervisor)
- `GET /api/conflicts`: List conflicts with optional `status` filter (`pending`, `resolved`, `all`). Supervisors see all; technicians see their submissions.
- `GET /api/conflicts/:id`: Retrieve complete 3-way diff comparison (Base vs Server vs Technician submission).
- `POST /api/conflicts/:id/resolve`: Resolve conflict using `keep_server`, `keep_client`, or `custom_merge`. Increments inspection OCC version, clears pending conflict flag, updates conflict record, and persists immutable `conflict_resolved` audit entry.

---

## 5. Offline-First Synchronization Workflow

1. **Local Enqueuing**: When offline (or on network failure), inspection creates and edits are saved directly to the browser's IndexedDB `outbox` with unique RFC4122 v4 `clientMutationId` values and optimistic local cache records.
2. **Connectivity Detection**: `SyncManager` monitors physical browser network events (`online`, `offline`) and supports a simulated offline toggle in the UI for live demonstrations.
3. **Automatic Reconnection Sync**: As soon as internet connectivity returns, the outbox flushes queued mutations in a single batch to `POST /api/sync`.
4. **Idempotency Guarantee**: If a network packet is retransmitted or a batch is retried, the backend identifies existing `client_mutation_id` entries and returns the previously computed outcome without double-incrementing versions or duplicating audit entries.
5. **Conflict Arbitration**: Disjoint changes are auto-merged automatically. Real collisions (e.g. both technician and supervisor modified `overall_result` to different values) are flagged for supervisor review in the dedicated Conflict Review interface.

---

## 6. Seed Credentials (Development)

| Role | Email | Password | Name |
| :--- | :--- | :--- | :--- |
| **Technician** | `tech1@syncproof.internal` | `Technician123!` | Alex Rivera |
| **Technician** | `tech2@syncproof.internal` | `Technician123!` | Jordan Lee |
| **Supervisor** | `supervisor@syncproof.internal` | `Supervisor123!` | Morgan Davis |

---

## 7. Setup & Execution Instructions

### Prerequisites
- Node.js v20 or higher
- Optional: Docker / Docker Compose (for standalone PostgreSQL)

### Backend Setup
```bash
cd backend
npm install

# Run database migration (creates tables and indexes)
npm run db:migrate

# Seed development users and equipment
npm run db:seed

# Run database verification check
npm run db:verify

# Run full backend test suite (70 tests across 23 suites)
npm test

# Start the API server (runs on port 5000)
npm start
```

### Frontend Setup
```bash
cd frontend
npm install

# Run full frontend test suite (22 tests across 11 suites)
npm test

# Build production bundle
npm run build

# Start development server (runs on port 5173 with API proxy)
npm run dev
```

---

## 8. Test Suite Summary

- **Backend Test Suite**: **70 tests passed (100%)** across 23 test suites
  - Milestone 2: Authentication & RBAC (13 tests)
  - Milestone 3: Equipment & Inspection REST APIs with OCC (23 tests)
  - Milestone 4: Three-Way Merge Unit Tests (6 tests)
  - Milestone 4: Sync Engine, Idempotency & 3-Way Merge (16 tests)
  - Milestone 5: Conflict Review and Resolution REST APIs (11 tests)
  - End-to-End Offline-First Sync & Conflict Lifecycle Suite (1 comprehensive scenario test)
- **Frontend Test Suite**: **22 tests passed (100%)** across 11 test suites
  - UUID generation and schema version 2 initialization
  - Equipment caching and batch storage
  - Inspection caching and optimistic updates
  - Persistent outbox queue management (enqueue, update status, retry count tracking)
  - Offline inspection creation and draft editing workflows
  - Reconnection batch synchronization and temporary ID reconciliation
  - Server auto-merge result cache propagation
  - SyncManager connectivity tracking & simulated offline mode
  - Applied create mutations cache reconciliation
  - Conflicted update mutations flagging
  - Network failure safe recovery & exponential retry tracking
- **Total Tests**: **92 automated tests passed, 0 failures, 0 skipped**.
