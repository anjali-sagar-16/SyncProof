import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:5000/api';

test.describe('SyncProof End-to-End Senior QA Automation Suite', () => {
  let consoleErrors = [];
  let pageErrors = [];
  let failedRequests = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    failedRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    page.on('requestfailed', (req) => {
      // Ignore intentionally aborted or simulated offline requests
      if (!req.url().includes('/api/sync') && !req.failure()?.errorText?.includes('ABORTED')) {
        failedRequests.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
      }
    });
  });

  // ============================================================================
  // Workflow 1: Technician and Supervisor Authentication & Role Permissions
  // ============================================================================
  test('Workflow 1: Technician and supervisor authentication and role restrictions', async ({ page }) => {
    await page.goto('/');

    // 1. Verify Login Portal UI
    await expect(page.locator('h1')).toContainText('SyncProof Portal');

    // 2. Test Invalid Credentials
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('.alert-danger')).toBeVisible();
    await expect(page.locator('.alert-danger')).toContainText(/Invalid email or password/i);

    // 3. Technician Login
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // Verify technician session and navbar elements
    await expect(page.locator('.user-badge')).toContainText('Alex Rivera');
    await expect(page.locator('.role-pill.technician')).toContainText('technician');
    await expect(page.locator('button:has-text("New Inspection")')).toBeVisible();

    // 4. Logout
    await page.click('button:has-text("Logout")');
    await expect(page.locator('h1')).toContainText('SyncProof Portal');

    // 5. Supervisor Login
    await page.fill('input[type="email"]', 'supervisor@syncproof.internal');
    await page.fill('input[type="password"]', 'Supervisor123!');
    await page.click('button[type="submit"]');

    // Verify supervisor session and role badge
    await expect(page.locator('.user-badge')).toContainText('Morgan Davis');
    await expect(page.locator('.role-pill.supervisor')).toContainText('supervisor');
    await expect(page.locator('button[role="tab"]:has-text("Conflict Review")')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflow 2: Equipment Catalog Loading & Filtering
  // ============================================================================
  test('Workflow 2: Equipment catalog loading, search, and detail specifications', async ({ page }) => {
    // Login as technician
    await page.goto('/');
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // Navigate to Equipment Catalog
    await page.click('button[role="tab"]:has-text("Equipment Catalog")');
    await expect(page.locator('h2')).toContainText('Industrial Equipment Catalog');

    // Verify equipment items rendered
    const table = page.locator('table.data-table');
    await expect(table).toContainText('EQ-PUMP-001');
    await expect(table).toContainText('EQ-COMP-002');
    await expect(table).toContainText('EQ-GEN-003');
    await expect(table).toContainText('EQ-CONV-004');

    // Test search filter
    await page.fill('input[placeholder*="Search"]', 'PUMP');
    await page.click('button:has-text("Search")');
    await expect(table).toContainText('EQ-PUMP-001');
    await expect(table).not.toContainText('EQ-COMP-002');

    // Clear search filter
    await page.fill('input[placeholder*="Search"]', '');
    await page.click('button:has-text("Search")');
    await expect(table).toContainText('EQ-COMP-002');

    // Inspect equipment specification detail view
    const viewButton = table.locator('tr:has-text("EQ-PUMP-001") button:has-text("Details")');
    await viewButton.click();

    // Verify Equipment Detail View
    await expect(page.locator('h1')).toContainText('High-Pressure Water Pump #1');
    await expect(page.locator('text=SN-PUMP-2024-8841')).toBeVisible();
    await expect(page.locator('text=Recent Inspection History')).toBeVisible();

    // Navigate back to catalog
    await page.click('button:has-text("Back to Equipment List")');
    await expect(page.locator('h2')).toContainText('Industrial Equipment Catalog');

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflow 3: Creating and Updating an Inspection Online
  // ============================================================================
  test('Workflow 3: Creating and updating an inspection online with OCC version increments', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // Navigate to Inspections tab
    await page.click('button[role="tab"]:has-text("Inspections")');

    // Click New Inspection
    await page.click('button:has-text("New Inspection")');
    const modal = page.locator('.modal-content');
    await expect(modal.locator('.modal-header h3')).toContainText('New Equipment Inspection');

    // Fill form
    const uniquePressure = (80 + Math.floor(Math.random() * 50)).toString();
    const uniqueNote = `QA Online Test Inspection - ${Date.now()}`;
    await modal.locator('select >> nth=0').selectOption({ index: 0 });
    await modal.locator('select >> nth=1').selectOption('completed');
    await modal.locator('select >> nth=2').selectOption('pass');
    await modal.locator('input[placeholder*="68.5"]').fill('48.5');
    await modal.locator('input[placeholder*="120"]').fill(uniquePressure);
    await modal.locator('input[placeholder*="2.4"]').fill('1.3');
    await modal.locator('textarea').fill(uniqueNote);

    // Submit
    await modal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // The newly created inspection is at the top of the table
    const firstRow = page.locator('table.data-table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator('.badge-version')).toContainText('v1');
    await expect(firstRow).toContainText('Synced');
    await expect(firstRow).toContainText(`pressure_psi: ${uniquePressure}`);

    // Now edit the inspection (checking Optimistic Concurrency Control)
    await firstRow.locator('button:has-text("Edit")').click();
    const editModal = page.locator('.modal-content');
    await expect(editModal.locator('.modal-header h3')).toContainText('OCC Version v1');
    await expect(editModal.locator('textarea')).toHaveValue(uniqueNote);

    // Modify values
    const updatedNote = `${uniqueNote} - Updated OCC Online`;
    const updatedPressure = (parseInt(uniquePressure, 10) + 5).toString();
    await editModal.locator('textarea').fill(updatedNote);
    await editModal.locator('input[placeholder*="120"]').fill(updatedPressure);
    await editModal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify version incremented to v2
    const updatedRow = page.locator('table.data-table tbody tr').first();
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow.locator('.badge-version')).toContainText('v2');
    await expect(updatedRow).toContainText('Synced');
    await expect(updatedRow).toContainText(`pressure_psi: ${updatedPressure}`);

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflows 4 & 5: Offline Creation, Outbox Enqueue, and Draft Editing
  // ============================================================================
  test('Workflows 4 & 5: Offline inspection creation, outbox enqueuing, and draft modification', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // Switch to Simulated Offline Mode
    const connectivityPill = page.locator('button.connectivity-pill');
    await connectivityPill.click();
    await expect(connectivityPill).toContainText('Offline');

    // Create New Inspection while offline
    await page.click('button[role="tab"]:has-text("Inspections")');
    await page.click('button:has-text("New Inspection")');

    // Verify Offline warning banner in modal
    const modal = page.locator('.modal-content');
    await expect(modal.locator('.alert-warning')).toContainText(/Offline Mode: Inspection will be saved to your IndexedDB Outbox/i);

    const offlineTemp = (60 + Math.floor(Math.random() * 20)).toString();
    const offlineDraftNote = `QA Offline Draft - ${Date.now()}`;
    await modal.locator('select >> nth=0').selectOption({ index: 1 });
    await modal.locator('select >> nth=1').selectOption('completed');
    await modal.locator('select >> nth=2').selectOption('warning');
    await modal.locator('input[placeholder*="68.5"]').fill(offlineTemp);
    await modal.locator('input[placeholder*="120"]').fill('110.0');
    await modal.locator('textarea').fill(offlineDraftNote);

    // Submit to Offline Outbox
    await modal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify top row appears with Offline (Queued) badge and custom temperature reading
    const offlineRow = page.locator('table.data-table tbody tr').first();
    await expect(offlineRow).toBeVisible();
    await expect(offlineRow.getByText('Offline (Queued)')).toBeVisible();
    await expect(offlineRow).toContainText(`temperature_c: ${offlineTemp}`);

    // Verify Navbar shows 1 Queued
    await expect(page.locator('button:has-text("Queued")')).toBeVisible();

    // Inspect Outbox modal
    await page.click('button:has-text("Queued")');
    await expect(page.locator('.modal-header h3')).toContainText('Offline Mutation Outbox Queue');
    const outboxTable = page.locator('.modal-content table.data-table');
    await expect(outboxTable).toContainText('create');
    await expect(outboxTable).toContainText('pending');
    await page.click('.modal-header button'); // Close outbox modal

    // Workflow 5: Edit the offline draft before syncing
    await offlineRow.locator('button:has-text("Edit")').click();
    const editModal = page.locator('.modal-content');
    await expect(editModal.locator('textarea')).toHaveValue(offlineDraftNote);

    const revisedNote = `${offlineDraftNote} - Revised While Offline`;
    const revisedVibration = '3.9';
    await editModal.locator('textarea').fill(revisedNote);
    await editModal.locator('input[placeholder*="2.4"]').fill(revisedVibration);
    await editModal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify table updated with revised vibration reading and retains Offline badge
    const revisedRow = page.locator('table.data-table tbody tr').first();
    await expect(revisedRow).toBeVisible();
    await expect(revisedRow.getByText('Offline (Queued)')).toBeVisible();
    await expect(revisedRow).toContainText(`vibration_mms: ${revisedVibration}`);

    // Verify Outbox still contains exactly 1 consolidated mutation (no duplicate orphan update)
    await page.click('button:has-text("Queued")');
    const outboxRows = page.locator('.modal-content table.data-table tbody tr');
    await expect(outboxRows).toHaveCount(1);
    await page.click('.modal-header button');

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflow 6: Offline Refresh & IndexedDB Persistence
  // ============================================================================
  test('Workflow 6: Browser refresh while offline retains pending draft in IndexedDB', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // Toggle offline
    const connectivityPill = page.locator('button.connectivity-pill');
    await connectivityPill.click();
    await expect(connectivityPill).toContainText('Offline');

    // Create an offline draft
    const persistentTemp = (50 + Math.floor(Math.random() * 30)).toString();
    const persistentNote = `QA Persistence Test - ${Date.now()}`;
    await page.click('button[role="tab"]:has-text("Inspections")');
    await page.click('button:has-text("New Inspection")');
    const modal = page.locator('.modal-content');
    await modal.locator('select >> nth=0').selectOption({ index: 2 });
    await modal.locator('input[placeholder*="68.5"]').fill(persistentTemp);
    await modal.locator('textarea').fill(persistentNote);
    await modal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify row is created
    await expect(page.locator('table.data-table tbody tr').first()).toContainText(`temperature_c: ${persistentTemp}`);

    // Refresh the browser page while offline
    await page.reload();

    // Verify user is still authenticated
    await expect(page.locator('.user-badge')).toContainText('Alex Rivera');

    // Navigate to inspections
    await page.click('button[role="tab"]:has-text("Inspections")');

    // Verify offline draft survived browser restart
    const persistentRow = page.locator('table.data-table tbody tr').first();
    await expect(persistentRow).toBeVisible();
    await expect(persistentRow.getByText('Offline (Queued)')).toBeVisible();
    await expect(persistentRow).toContainText(`temperature_c: ${persistentTemp}`);

    // Ensure connectivity pill is in Online state
    const pill = page.locator('button.connectivity-pill');
    const pillText = await pill.innerText();
    if (pillText.includes('Offline')) {
      await pill.click();
    }
    await expect(pill).toContainText('Online');

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflows 7 & 8: Reconnection, Automatic Batch Sync & Temporary ID Replacement
  // ============================================================================
  test('Workflows 7 & 8: Automatic synchronization on reconnect and temporary ID replacement', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'tech1@syncproof.internal');
    await page.fill('input[type="password"]', 'Technician123!');
    await page.click('button[type="submit"]');

    // 1. Enter offline mode
    await page.click('button.connectivity-pill');
    await expect(page.locator('button.connectivity-pill')).toContainText('Offline');

    // 2. Create offline inspection
    const autoSyncTemp = (70 + Math.floor(Math.random() * 20)).toString();
    const autoSyncNote = `QA AutoSync Test - ${Date.now()}`;
    await page.click('button[role="tab"]:has-text("Inspections")');
    await page.click('button:has-text("New Inspection")');
    const modal = page.locator('.modal-content');
    await modal.locator('select >> nth=0').selectOption({ index: 3 });
    await modal.locator('select >> nth=2').selectOption('pass');
    await modal.locator('input[placeholder*="68.5"]').fill(autoSyncTemp);
    await modal.locator('textarea').fill(autoSyncNote);
    await modal.locator('button[type="submit"]').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify queued status
    const queuedRow = page.locator('table.data-table tbody tr').first();
    await expect(queuedRow.getByText('Offline (Queued)')).toBeVisible();
    await expect(queuedRow).toContainText(`temperature_c: ${autoSyncTemp}`);
    await expect(page.locator('button:has-text("Queued")')).toBeVisible();

    // 3. Reconnect to Online
    await page.click('button.connectivity-pill');
    await expect(page.locator('button.connectivity-pill')).toContainText('Online');

    // 4. Trigger sync or wait for auto-reconnect sync
    await page.waitForTimeout(1500);

    // If still queued, click manual sync
    const outboxPill = page.locator('button[title*="outbox"]');
    if ((await outboxPill.innerText()).includes('Queued')) {
      await page.click('button[title*="Trigger batch synchronization"]');
      await page.waitForTimeout(2000);
    }

    // 5. Verify record transitioned to Synced with v1
    const syncedRow = page.locator('table.data-table tbody tr').first();
    await expect(syncedRow).toBeVisible();
    await expect(syncedRow).toContainText('Synced');
    await expect(syncedRow.locator('.badge-version')).toContainText('v1');
    await expect(syncedRow).toContainText(`temperature_c: ${autoSyncTemp}`);

    // 6. Workflow 8: Open Outbox modal and verify mutation is marked synced
    await page.click('button[title*="outbox"]');
    await expect(page.locator('.modal-header h3')).toContainText('Offline Mutation Outbox Queue');
    await expect(page.locator('.modal-content table.data-table')).toContainText('synced');

    // Clear synced mutations
    await page.click('button:has-text("Clear Synced")');
    await expect(page.locator('text=Outbox is Completely Synchronized')).toBeVisible();
    await page.click('.modal-header button');

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflow 9: Idempotency Barrier & Duplicate Replay Protection
  // ============================================================================
  test('Workflow 9: Duplicate mutation handling and idempotency guarantee', async ({ request }) => {
    // 1. Authenticate via API
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { email: 'tech1@syncproof.internal', password: 'Technician123!' },
    });
    expect(loginRes.status()).toBe(200);
    const { token } = await loginRes.json();

    // 2. Fetch an equipment ID
    const equipRes = await request.get(`${API_URL}/equipment`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const equipment = (await equipRes.json()).equipment;
    const targetEquipId = equipment[0].id;

    // 3. Generate a dynamic clientMutationId
    const clientMutationId = randomUUID();

    const mutationPayload = {
      mutations: [
        {
          clientMutationId,
          action: 'create',
          equipmentId: targetEquipId,
          status: 'completed',
          overall_result: 'pass',
          readings: { temperature_c: 44.0 },
          notes: 'Idempotency initial submission',
        },
      ],
    };

    // First Submission
    const firstRes = await request.post(`${API_URL}/sync`, {
      headers: { Authorization: `Bearer ${token}` },
      data: mutationPayload,
    });
    expect(firstRes.status()).toBe(200);
    const firstJson = await firstRes.json();
    const createdInspectionId = firstJson.results[0].entityId;
    expect(firstJson.results[0].status).toBe('applied');

    // Second Replayed Submission (Exact same clientMutationId)
    const replayRes = await request.post(`${API_URL}/sync`, {
      headers: { Authorization: `Bearer ${token}` },
      data: mutationPayload,
    });
    expect(replayRes.status()).toBe(200);
    const replayJson = await replayRes.json();

    // Verify replay indicator is true and returns identical entityId
    expect(replayJson.results[0].replayed).toBe(true);
    expect(replayJson.results[0].entityId).toBe(createdInspectionId);

    // Verify database did not create a duplicate inspection record
    const inspRes = await request.get(`${API_URL}/inspections/${createdInspectionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(inspRes.status()).toBe(200);
    const inspData = await inspRes.json();
    expect(inspData.inspection.version).toBe(1);
  });

  // ============================================================================
  // Workflows 10 & 11: Concurrent Edit Collision & Supervisor Conflict Arbitration
  // ============================================================================
  test('Workflows 10 & 11: Concurrent edit collision detection and supervisor arbitration', async ({ page, request }) => {
    // 1. Authenticate technician and create a base inspection
    const techLogin = await request.post(`${API_URL}/auth/login`, {
      data: { email: 'tech1@syncproof.internal', password: 'Technician123!' },
    });
    const { token: techToken } = await techLogin.json();

    const equipRes = await request.get(`${API_URL}/equipment`, {
      headers: { Authorization: `Bearer ${techToken}` },
    });
    const equipId = (await equipRes.json()).equipment[0].id;

    // Create initial inspection at version 1
    const uniqueReading = Number((50 + Math.random() * 40).toFixed(4));
    const createRes = await request.post(`${API_URL}/inspections`, {
      headers: { Authorization: `Bearer ${techToken}` },
      data: {
        equipment_id: equipId,
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: uniqueReading, pressure_psi: 80.0 },
        notes: 'Base Inspection for Collision Test',
      },
    });
    const inspection = (await createRes.json()).inspection;
    const inspectionId = inspection.id;

    // 2. Server-side update (increments to version 2, overall_result = 'fail')
    const serverUpdate = await request.put(`${API_URL}/inspections/${inspectionId}`, {
      headers: { Authorization: `Bearer ${techToken}` },
      data: {
        baseVersion: 1,
        status: 'completed',
        overall_result: 'fail',
        notes: 'Server updated to FAIL',
      },
    });
    expect(serverUpdate.status()).toBe(200);

    // 3. Technician sync update with stale baseVersion: 1 and colliding overall_result = 'warning'
    const collisionMutationId = randomUUID();
    const syncRes = await request.post(`${API_URL}/sync`, {
      headers: { Authorization: `Bearer ${techToken}` },
      data: {
        mutations: [
          {
            clientMutationId: collisionMutationId,
            action: 'update',
            entityId: inspectionId,
            baseVersion: 1,
            clientState: {
              status: 'completed',
              overall_result: 'warning',
              readings: { temperature_c: uniqueReading },
              notes: 'Technician conflicting offline submission',
            },
            baseState: {
              status: 'completed',
              overall_result: 'pass',
              readings: { temperature_c: 40.0, pressure_psi: 80.0 },
              notes: 'Base Inspection for Collision Test',
            },
          },
        ],
      },
    });

    expect(syncRes.status()).toBe(200);
    const syncData = await syncRes.json();
    expect(syncData.results[0].status).toBe('conflicted');
    expect(syncData.results[0].conflictingFields).toContain('overall_result');
    const conflictId = syncData.results[0].conflictId;

    // 4. Workflow 11: Supervisor reviews and arbitrates conflict via UI
    await page.goto('/');
    await page.fill('input[type="email"]', 'supervisor@syncproof.internal');
    await page.fill('input[type="password"]', 'Supervisor123!');
    await page.click('button[type="submit"]');

    // Navigate to Conflict Review tab
    await page.click('button[role="tab"]:has-text("Conflict Review")');
    await expect(page.locator('h2')).toContainText('Concurrent Edit Conflicts & Review Queue');

    // Verify conflict entry in table
    const conflictRow = page.locator('table.data-table tbody tr').first();
    await expect(conflictRow).toBeVisible();
    await expect(conflictRow).toContainText('overall_result');

    // Click Resolve
    await conflictRow.locator('button:has-text("Resolve")').click();
    await expect(page.locator('.modal-header h3')).toContainText('Supervisor Conflict Resolution');

    // Verify 3-way state comparison table is displayed
    const diffTable = page.locator('table.diff-table');
    await expect(diffTable).toBeVisible();
    await expect(diffTable).toContainText('Evaluation');
    await expect(diffTable).toContainText('Conflict');

    // Choose 'Accept Technician' strategy
    await page.click('label:has-text("Accept Technician") input[type="radio"]');

    // Enter supervisor audit justification note
    await page.fill('textarea[placeholder*="Explain the technical basis"]', 'Supervisor approved technician on-site evaluation.');

    // Commit Resolution
    await page.click('button[type="submit"]:has-text("Commit Resolution")');
    await expect(page.locator('.modal-backdrop')).toBeHidden();

    // Verify Inspection record in Inspections tab
    await page.click('button[role="tab"]:has-text("Inspections")');
    const resolvedInspRow = page.locator('table.data-table tbody tr').filter({ hasText: `temperature_c: ${uniqueReading}` }).first();
    await expect(resolvedInspRow).toBeVisible();
    await expect(resolvedInspRow.locator('.badge-version')).toContainText('v3');
    await expect(resolvedInspRow).toContainText('Synced');

    expect(pageErrors).toHaveLength(0);
  });

  // ============================================================================
  // Workflow 12: Audit Trail Verification & Database Consistency
  // ============================================================================
  test('Workflow 12: Audit trail persistence and OCC version history verification', async ({ request }) => {
    // Authenticate supervisor
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { email: 'supervisor@syncproof.internal', password: 'Supervisor123!' },
    });
    const { token } = await loginRes.json();

    // Fetch inspections list
    const inspListRes = await request.get(`${API_URL}/inspections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const inspections = (await inspListRes.json()).inspections;
    expect(inspections.length).toBeGreaterThan(0);

    // Pick first inspection and retrieve full audit trail
    const targetId = inspections[0].id;
    const detailRes = await request.get(`${API_URL}/inspections/${targetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detailRes.status()).toBe(200);
    const { inspection } = await detailRes.json();

    expect(inspection).toBeDefined();
    expect(inspection.auditHistory).toBeDefined();
    expect(Array.isArray(inspection.auditHistory)).toBe(true);
    expect(inspection.auditHistory.length).toBeGreaterThan(0);

    // Verify audit log properties
    for (const entry of inspection.auditHistory) {
      expect(entry.action).toBeDefined();
      expect(['created', 'updated', 'auto_merged', 'conflict_flagged', 'conflict_resolved']).toContain(entry.action);
      expect(entry.version).toBeGreaterThanOrEqual(1);
      expect(entry.created_at).toBeDefined();
    }
  });
});
