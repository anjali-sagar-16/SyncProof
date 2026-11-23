import React, { useState } from 'react';
import { X, CheckCircle, AlertTriangle, Shield, GitMerge, Server, User, ArrowRight } from 'lucide-react';
import { api } from '../api/client';

export default function ConflictResolutionModal({ conflict, onClose, onSuccess }) {
  if (!conflict) return null;

  // Parse states if stringified
  const baseState = typeof conflict.base_state === 'string' ? JSON.parse(conflict.base_state) : (conflict.base_state || {});
  const serverState = typeof conflict.server_state === 'string' ? JSON.parse(conflict.server_state) : (conflict.server_state || {});
  const clientState = typeof conflict.client_state === 'string' ? JSON.parse(conflict.client_state) : (conflict.client_state || {});
  const conflictingFields = Array.isArray(conflict.conflicting_fields)
    ? conflict.conflicting_fields
    : (typeof conflict.conflicting_fields === 'string' ? JSON.parse(conflict.conflicting_fields) : []);

  const [strategy, setStrategy] = useState('keep_client'); // Default suggestion is often reviewing the technician's findings
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Custom merge state initialized with sensible defaults
  const [customStatus, setCustomStatus] = useState(serverState.status || 'completed');
  const [customResult, setCustomResult] = useState(clientState.overall_result || serverState.overall_result || 'warning');
  const [customNotes, setCustomNotes] = useState(clientState.notes || serverState.notes || '');

  const serverReadings = serverState.readings || {};
  const clientReadings = clientState.readings || {};
  const [customTemp, setCustomTemp] = useState(clientReadings.temperature_c ?? serverReadings.temperature_c ?? '');
  const [customPressure, setCustomPressure] = useState(clientReadings.pressure_psi ?? serverReadings.pressure_psi ?? '');
  const [customVibration, setCustomVibration] = useState(clientReadings.vibration_mms ?? serverReadings.vibration_mms ?? '');

  const handleResolve = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        resolutionStrategy: strategy,
        notes: notes || `Resolved by supervisor using ${strategy} strategy.`,
      };

      if (strategy === 'custom_merge') {
        const mergedReadings = {
          ...serverReadings,
          ...clientReadings,
        };
        if (customTemp !== '') mergedReadings.temperature_c = parseFloat(customTemp);
        if (customPressure !== '') mergedReadings.pressure_psi = parseFloat(customPressure);
        if (customVibration !== '') mergedReadings.vibration_mms = parseFloat(customVibration);

        payload.resolvedState = {
          status: customStatus,
          overall_result: customResult,
          readings: mergedReadings,
          notes: customNotes,
        };
      }

      await api.resolveConflict(conflict.id, payload);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to resolve conflict.');
    } finally {
      setSubmitting(false);
    }
  };

  const isFieldConflicted = (fieldName) => conflictingFields.includes(fieldName);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '880px', width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitMerge size={20} color="#ea580c" />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              Supervisor Conflict Resolution
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleResolve}>
          <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            {/* Context Info Banner */}
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Equipment</span>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>
                  [{conflict.equipment_code}] {conflict.equipment_name}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Technician</span>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>{conflict.technician_name}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Version Shift</span>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0369a1' }}>
                  v{conflict.base_version} (Base) <ArrowRight size={12} style={{ display: 'inline' }} /> v{conflict.server_version} (Server)
                </div>
              </div>
            </div>

            {/* Conflicting Fields Alert */}
            <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
              <AlertTriangle size={18} />
              <div>
                <strong>Overlapping Collisions Detected:</strong>
                <p style={{ marginTop: '2px', fontSize: '0.85rem' }}>
                  Both the client offline edit and the server version independently modified:{' '}
                  <strong>{conflictingFields.join(', ')}</strong>.
                </p>
              </div>
            </div>

            {error && (
              <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
                <span>{error}</span>
              </div>
            )}

            {/* 3-Way Diff Table */}
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
              Three-Way State Comparison
            </h4>
            <div className="table-container" style={{ marginBottom: '20px' }}>
              <table className="diff-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Field</th>
                    <th style={{ width: '26%' }}>Base State (v{conflict.base_version})</th>
                    <th style={{ width: '26%', background: '#f1f5f9' }}>Server Current (v{conflict.server_version})</th>
                    <th style={{ width: '26%', background: '#eff6ff' }}>Technician Offline Submission</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Status row */}
                  <tr className={isFieldConflicted('status') ? 'is-conflicted' : ''}>
                    <td>
                      <strong>Status</strong>
                      {isFieldConflicted('status') && <span className="badge badge-conflict" style={{ marginLeft: '6px' }}>Conflict</span>}
                    </td>
                    <td>{baseState.status || 'N/A'}</td>
                    <td><strong>{serverState.status || 'N/A'}</strong></td>
                    <td style={{ color: '#2563eb', fontWeight: 600 }}>{clientState.status || 'N/A'}</td>
                  </tr>

                  {/* Overall Result row */}
                  <tr className={isFieldConflicted('overall_result') ? 'is-conflicted' : ''}>
                    <td>
                      <strong>Evaluation</strong>
                      {isFieldConflicted('overall_result') && <span className="badge badge-conflict" style={{ marginLeft: '6px' }}>Conflict</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${baseState.overall_result || 'warning'}`}>
                        {baseState.overall_result || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${serverState.overall_result || 'warning'}`}>
                        {serverState.overall_result || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${clientState.overall_result || 'warning'}`}>
                        {clientState.overall_result || 'N/A'}
                      </span>
                    </td>
                  </tr>

                  {/* Telemetry Readings */}
                  <tr className={isFieldConflicted('readings') ? 'is-conflicted' : ''}>
                    <td>
                      <strong>Readings</strong>
                      {isFieldConflicted('readings') && <span className="badge badge-conflict" style={{ marginLeft: '6px' }}>Conflict</span>}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {JSON.stringify(baseState.readings || {})}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {JSON.stringify(serverState.readings || {})}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#2563eb' }}>
                      {JSON.stringify(clientState.readings || {})}
                    </td>
                  </tr>

                  {/* Notes row */}
                  <tr className={isFieldConflicted('notes') ? 'is-conflicted' : ''}>
                    <td>
                      <strong>Notes</strong>
                      {isFieldConflicted('notes') && <span className="badge badge-conflict" style={{ marginLeft: '6px' }}>Conflict</span>}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{baseState.notes || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{serverState.notes || '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: '#1d4ed8' }}>{clientState.notes || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Strategy Selection */}
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
              Resolution Strategy
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: `2px solid ${strategy === 'keep_client' ? '#2563eb' : '#e2e8f0'}`,
                  background: strategy === 'keep_client' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="resolutionStrategy"
                  value="keep_client"
                  checked={strategy === 'keep_client'}
                  onChange={() => setStrategy('keep_client')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <User size={15} color="#2563eb" /> Accept Technician
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    Accept on-site technician's submission as the source of truth.
                  </p>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: `2px solid ${strategy === 'keep_server' ? '#2563eb' : '#e2e8f0'}`,
                  background: strategy === 'keep_server' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="resolutionStrategy"
                  value="keep_server"
                  checked={strategy === 'keep_server'}
                  onChange={() => setStrategy('keep_server')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <Server size={15} color="#475569" /> Preserve Server
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    Retain current server version, discarding conflicting client inputs.
                  </p>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: `2px solid ${strategy === 'custom_merge' ? '#2563eb' : '#e2e8f0'}`,
                  background: strategy === 'custom_merge' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="resolutionStrategy"
                  value="custom_merge"
                  checked={strategy === 'custom_merge'}
                  onChange={() => setStrategy('custom_merge')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <GitMerge size={15} color="#ea580c" /> Custom Arbitrated Merge
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    Manually arbitrate values for each field.
                  </p>
                </div>
              </label>
            </div>

            {/* Custom Merge Form Fields */}
            {strategy === 'custom_merge' && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <h5 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', color: '#1e293b' }}>
                  Arbitrated Record Values
                </h5>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Status</label>
                    <select
                      value={customStatus}
                      onChange={(e) => setCustomStatus(e.target.value)}
                      className="form-select"
                    >
                      <option value="completed">Completed</option>
                      <option value="in_progress">In Progress</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Evaluation</label>
                    <select
                      value={customResult}
                      onChange={(e) => setCustomResult(e.target.value)}
                      className="form-select"
                    >
                      <option value="pass">Pass</option>
                      <option value="warning">Warning</option>
                      <option value="fail">Fail</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Temp (°C)</label>
                    <input
                      type="number"
                      step="any"
                      value={customTemp}
                      onChange={(e) => setCustomTemp(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Pressure (psi)</label>
                    <input
                      type="number"
                      step="any"
                      value={customPressure}
                      onChange={(e) => setCustomPressure(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Vibration (mm/s)</label>
                    <input
                      type="number"
                      step="any"
                      value={customVibration}
                      onChange={(e) => setCustomVibration(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Arbitrated Notes</label>
                  <textarea
                    rows={2}
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    className="form-textarea"
                  />
                </div>
              </div>
            )}

            {/* Supervisor Audit Notes */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Resolution Justification (Audit Log Note)</label>
              <textarea
                rows={2}
                placeholder="Explain the technical basis for this resolution (recorded in immutable audit log)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="form-textarea"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              {submitting ? 'Applying Resolution...' : 'Commit Resolution & Increment Version'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
