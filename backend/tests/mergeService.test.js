const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { threeWayMerge } = require('../src/services/mergeService');

describe('Milestone 4: Three-Way Merge Service Unit Tests', () => {
  test('Clean merge when only client changed fields', () => {
    const baseState = {
      status: 'in_progress',
      overall_result: null,
      notes: 'Initial notes',
      readings: { temp: 40 },
    };
    const serverState = { ...baseState }; // Server unchanged
    const clientState = {
      ...baseState,
      notes: 'Updated notes by technician',
      readings: { temp: 45 },
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, true);
    assert.equal(res.conflictingFields.length, 0);
    assert.equal(res.mergedState.notes, 'Updated notes by technician');
    assert.equal(res.mergedState.readings.temp, 45);
    assert.ok(res.changedFields.includes('notes'));
    assert.ok(res.changedFields.includes('readings'));
  });

  test('Clean auto-merge for disjoint scalar field changes (Client edited notes, Server edited status)', () => {
    const baseState = {
      status: 'scheduled',
      overall_result: null,
      notes: 'Clean start',
      readings: { hours: 100 },
    };
    const serverState = {
      status: 'in_progress', // Server changed status
      overall_result: null,
      notes: 'Clean start',
      readings: { hours: 100 },
    };
    const clientState = {
      status: 'scheduled',
      overall_result: null,
      notes: 'Technician logged arrival', // Client changed notes
      readings: { hours: 100 },
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, true);
    assert.equal(res.conflictingFields.length, 0);
    assert.equal(res.mergedState.status, 'in_progress'); // Kept server change
    assert.equal(res.mergedState.notes, 'Technician logged arrival'); // Applied client change
    assert.deepEqual(res.changedFields, ['notes']);
  });

  test('Clean auto-merge for disjoint telemetry readings (Client edited temp, Server edited pressure)', () => {
    const baseState = {
      status: 'completed',
      overall_result: 'pass',
      notes: 'Operating',
      readings: { temp: 40, pressure: 80 },
    };
    const serverState = {
      ...baseState,
      readings: { temp: 40, pressure: 95 }, // Server updated pressure
    };
    const clientState = {
      ...baseState,
      readings: { temp: 52, pressure: 80 }, // Client updated temp
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, true);
    assert.equal(res.conflictingFields.length, 0);
    assert.equal(res.mergedState.readings.temp, 52); // Client's temp merged
    assert.equal(res.mergedState.readings.pressure, 95); // Server's pressure preserved
  });

  test('Conflict detected when both client and server change overall_result to different values', () => {
    const baseState = {
      status: 'in_progress',
      overall_result: null,
      notes: 'Inspecting',
      readings: {},
    };
    const serverState = {
      ...baseState,
      status: 'completed',
      overall_result: 'pass', // Server evaluated pass
    };
    const clientState = {
      ...baseState,
      status: 'completed',
      overall_result: 'fail', // Client evaluated fail
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, false);
    assert.ok(res.conflictingFields.includes('overall_result'));
  });

  test('Conflict detected when both client and server change the same reading key to different values', () => {
    const baseState = {
      status: 'completed',
      overall_result: 'pass',
      notes: '',
      readings: { voltage: 12.0 },
    };
    const serverState = {
      ...baseState,
      readings: { voltage: 12.8 },
    };
    const clientState = {
      ...baseState,
      readings: { voltage: 11.2 },
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, false);
    assert.ok(res.conflictingFields.includes('readings.voltage'));
  });

  test('No conflict when both client and server change a field to the exact same value', () => {
    const baseState = {
      status: 'scheduled',
      overall_result: null,
      notes: '',
      readings: {},
    };
    const serverState = {
      ...baseState,
      status: 'in_progress',
    };
    const clientState = {
      ...baseState,
      status: 'in_progress', // Both transitioned to 'in_progress'
    };

    const res = threeWayMerge({ baseState, serverState, clientState });
    assert.equal(res.canAutoMerge, true);
    assert.equal(res.conflictingFields.length, 0);
    assert.equal(res.mergedState.status, 'in_progress');
  });
});
