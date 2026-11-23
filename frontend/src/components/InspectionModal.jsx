import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, AlertCircle, Wrench, ShieldCheck, WifiOff, Cloud } from 'lucide-react';
import { api } from '../api/client';
import { getAllEquipment, saveInspection } from '../db/indexedDb';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';

export default function InspectionModal({ inspection, preselectedEquipmentId, onClose, onSuccess }) {
  const isEdit = Boolean(inspection);
  const { user } = useAuth();
  const { isOnline, saveNewInspection, saveUpdatedInspection } = useSync();

  const [equipmentList, setEquipmentList] = useState([]);
  const [equipmentId, setEquipmentId] = useState(
    inspection?.equipment_id || preselectedEquipmentId || ''
  );
  const [status, setStatus] = useState(inspection?.status || 'completed');
  const [overallResult, setOverallResult] = useState(inspection?.overall_result || 'pass');
  const [notes, setNotes] = useState(inspection?.notes || '');

  // Telemetry readings
  const initialReadings = typeof inspection?.readings === 'string'
    ? JSON.parse(inspection?.readings || '{}')
    : (inspection?.readings || {});

  const [temp, setTemp] = useState(initialReadings.temperature_c ?? initialReadings.temp_c ?? '');
  const [pressure, setPressure] = useState(initialReadings.pressure_psi ?? '');
  const [vibration, setVibration] = useState(initialReadings.vibration_mms ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [conflictError, setConflictError] = useState(null);

  useEffect(() => {
    // Load equipment list for dropdown
    async function loadEquip() {
      try {
        const data = await api.getEquipmentList();
        if (data.equipment) {
          setEquipmentList(data.equipment);
          if (!equipmentId && data.equipment.length > 0) {
            setEquipmentId(data.equipment[0].id);
          }
        }
      } catch {
        const cached = await getAllEquipment();
        if (cached && cached.length > 0) {
          setEquipmentList(cached);
          if (!equipmentId) setEquipmentId(cached[0].id);
        }
      }
    }
    loadEquip();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setConflictError(null);

    if (!equipmentId) {
      setError('Please select an equipment item.');
      return;
    }

    setSubmitting(true);

    const readings = {};
    if (temp !== '') readings.temperature_c = parseFloat(temp);
    if (pressure !== '') readings.pressure_psi = parseFloat(pressure);
    if (vibration !== '') readings.vibration_mms = parseFloat(vibration);

    try {
      if (isEdit) {
        // Optimistic Concurrency Control update with offline outbox fallback
        const payload = {
          baseVersion: inspection.version,
          status,
          overall_result: overallResult,
          readings,
          notes,
        };

        await saveUpdatedInspection(inspection.id, payload, inspection, user);
        onSuccess();
      } else {
        // Find selected equipment details for offline optimistic record
        const selectedEquip = equipmentList.find((eq) => eq.id === equipmentId);

        const payload = {
          equipment_id: equipmentId,
          equipment_code: selectedEquip?.code || 'EQUIP',
          equipment_name: selectedEquip?.name || 'Equipment',
          status,
          overall_result: overallResult,
          readings,
          notes,
        };

        await saveNewInspection(payload, user);
        onSuccess();
      }
    } catch (err) {
      if (err.status === 409) {
        // OCC Conflict detected
        setConflictError({
          message: err.data?.message || 'Version mismatch detected. Another user committed a change first.',
          currentVersion: err.data?.currentVersion,
          submittedVersion: err.data?.submittedVersion,
        });
      } else {
        setError(err.message || 'Operation failed. Please check your inputs.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wrench size={18} color="#2563eb" />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              {isEdit ? `Edit Inspection (OCC Version v${inspection.version})` : 'New Equipment Inspection'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Offline Notification Banner */}
            {!isOnline && (
              <div className="alert alert-warning" style={{ marginBottom: '16px' }}>
                <WifiOff size={16} />
                <span>
                  <strong>Offline Mode:</strong> Inspection will be saved to your IndexedDB Outbox and automatically synced upon reconnection.
                </span>
              </div>
            )}

            {/* Version Information Banner */}
            {isEdit && (
              <div className="alert alert-info" style={{ marginBottom: '16px' }}>
                <ShieldCheck size={16} />
                <span>
                  Optimistic Locking active: Submitting against Base Version <strong>v{inspection.version}</strong>.
                </span>
              </div>
            )}

            {/* OCC Conflict Warning */}
            {conflictError && (
              <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>Concurrency Conflict (HTTP 409):</strong>
                  <p style={{ marginTop: '2px', fontSize: '0.85rem' }}>{conflictError.message}</p>
                  <p style={{ fontSize: '0.8rem', marginTop: '4px', opacity: 0.9 }}>
                    Current Server Version: <strong>v{conflictError.currentVersion}</strong> | Your Base Version: <strong>v{conflictError.submittedVersion}</strong>.
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="alert alert-danger">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Equipment Selection */}
            <div className="form-group">
              <label className="form-label">Equipment</label>
              <select
                value={equipmentId}
                onChange={(e) => setEquipmentId(e.target.value)}
                className="form-select"
                disabled={isEdit || submitting}
              >
                {equipmentList.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    [{eq.code}] {eq.name} - {eq.location}
                  </option>
                ))}
              </select>
            </div>

            {/* Status & Overall Result */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Inspection Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="form-select"
                  disabled={submitting}
                >
                  <option value="completed">Completed</option>
                  <option value="in_progress">In Progress</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Overall Evaluation</label>
                <select
                  value={overallResult}
                  onChange={(e) => setOverallResult(e.target.value)}
                  className="form-select"
                  disabled={submitting}
                >
                  <option value="pass">Pass</option>
                  <option value="warning">Warning</option>
                  <option value="fail">Fail</option>
                </select>
              </div>
            </div>

            {/* Telemetry Readings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Temp (°C)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 68.5"
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  className="form-input"
                  disabled={submitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Pressure (psi)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 120"
                  value={pressure}
                  onChange={(e) => setPressure(e.target.value)}
                  className="form-input"
                  disabled={submitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Vibration (mm/s)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 2.4"
                  value={vibration}
                  onChange={(e) => setVibration(e.target.value)}
                  className="form-input"
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Field Notes / Observations</label>
              <textarea
                rows={3}
                placeholder="Enter physical observations, component conditions, or maintenance notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="form-textarea"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary btn-sm"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting}
            >
              <Save size={14} />
              <span>
                {submitting
                  ? 'Saving...'
                  : isOnline
                  ? isEdit
                    ? 'Save Changes'
                    : 'Submit Inspection'
                  : 'Save to Offline Outbox'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
