import React, { useState, useEffect } from 'react';
import { ClipboardList, PlusCircle, RefreshCw, AlertTriangle, Edit, Database } from 'lucide-react';
import { api } from '../api/client';
import { saveInspectionBatch, getAllInspections } from '../db/indexedDb';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';

export default function InspectionList({ onNewInspection, onEditInspection, onNavigateToConflicts }) {
  const { user, isSupervisor } = useAuth();
  const { lastSyncTime } = useSync();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchInspections = async () => {
    setLoading(true);
    setError(null);
    setFromCache(false);

    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;

      const data = await api.getInspectionList(params);
      let list = data.inspections || [];

      // Merge local IndexedDB pending offline inspections and optimistic updates
      try {
        const cached = await getAllInspections();
        if (cached && cached.length > 0) {
          const offlineMap = new Map();
          for (const item of cached) {
            if (item._isOffline) {
              offlineMap.set(item.id, item);
            }
          }

          if (offlineMap.size > 0) {
            // Replace matching records with pending offline optimistic versions
            list = list.map((item) => offlineMap.get(item.id) || item);
            // Prepend new offline drafts not yet on server
            const offlineCreates = Array.from(offlineMap.values()).filter(
              (item) => !list.some((s) => s.id === item.id)
            );
            list = [...offlineCreates, ...list];
          }
        }
      } catch (cacheErr) {
        console.warn('[InspectionList] Local cache merge warning:', cacheErr);
      }

      // Filter by status if filter active and offline items were merged
      if (statusFilter) {
        list = list.filter((i) => i.status === statusFilter);
      }

      setInspections(list);

      if (data.inspections && data.inspections.length > 0) {
        saveInspectionBatch(data.inspections).catch(() => {});
      }
    } catch (err) {
      console.warn('[API] Could not fetch inspections, falling back to IndexedDB...', err);
      try {
        const cached = await getAllInspections();
        if (cached && cached.length > 0) {
          let list = cached;
          if (statusFilter) {
            list = list.filter((i) => i.status === statusFilter);
          }
          setInspections(list);
          setFromCache(true);
          setError('Network request failed. Displaying cached inspection records from IndexedDB.');
        } else {
          setError(err.message || 'Failed to fetch inspections.');
        }
      } catch {
        setError(err.message || 'Failed to fetch inspections.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInspections();
  }, [statusFilter, lastSyncTime]);

  const canEdit = (insp) => {
    if (user?.role === 'supervisor') return true;
    return insp.inspector_id === user?.id;
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ClipboardList size={20} color="#2563eb" />
            <span>Equipment Inspection Records</span>
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Historical inspection records, OCC versions, and pending conflict reviews.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchInspections} className="btn btn-secondary btn-sm" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>

          <button onClick={onNewInspection} className="btn btn-primary btn-sm">
            <PlusCircle size={14} />
            <span>New Inspection</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-select"
          style={{ width: 'auto', minWidth: '160px' }}
        >
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In Progress</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>

      {fromCache && (
        <div className="alert alert-warning">
          <Database size={16} />
          <span>Offline Fallback: Displaying {inspections.length} cached inspections from IndexedDB.</span>
        </div>
      )}

      {error && !fromCache && (
        <div className="alert alert-danger">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading inspection records...</p>
        </div>
      ) : inspections.length === 0 ? (
        <div className="loading-container" style={{ padding: '36px' }}>
          <p style={{ color: '#64748b' }}>No inspection records found.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Result</th>
                <th>Status</th>
                <th>OCC Version</th>
                <th>Conflict Status</th>
                <th>Inspector</th>
                <th>Telemetry Readings</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((insp) => {
                const readings = typeof insp.readings === 'string'
                  ? JSON.parse(insp.readings || '{}')
                  : (insp.readings || {});
                const readingsSummary = Object.entries(readings)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ');

                return (
                  <tr key={insp.id}>
                    <td>
                      <div>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
                          {insp.equipment_code || 'N/A'}
                        </span>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {insp.equipment_name}
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={`badge badge-${insp.overall_result || 'warning'}`}>
                        {insp.overall_result || 'N/A'}
                      </span>
                    </td>

                    <td>
                      <span style={{ textTransform: 'capitalize' }}>{insp.status}</span>
                    </td>

                    {/* OCC Version indicator */}
                    <td>
                      <span className="badge badge-version" title="Optimistic Concurrency Control Version">
                        v{insp.version}
                      </span>
                    </td>

                    {/* Pending Conflict Indicator */}
                    <td>
                      {insp._isOffline ? (
                        <span className="badge badge-warning" title="Saved locally in IndexedDB Outbox, pending upload">
                          Offline (Queued)
                        </span>
                      ) : insp.has_pending_conflict ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="badge badge-conflict" title="A concurrent edit collision requires supervisor review">
                            <AlertTriangle size={11} /> Conflict Pending
                          </span>
                          {isSupervisor && onNavigateToConflicts && (
                            <button
                              type="button"
                              onClick={() => onNavigateToConflicts(insp.id)}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                            >
                              Review
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                          Synced
                        </span>
                      )}
                    </td>

                    <td>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                        {insp.inspector_name || 'Technician'}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.8rem', color: '#475569', fontFamily: 'monospace' }} title={JSON.stringify(readings)}>
                        {readingsSummary || 'None'}
                      </span>
                    </td>

                    <td style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {new Date(insp.created_at).toLocaleDateString()}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      {canEdit(insp) ? (
                        <button
                          onClick={() => onEditInspection(insp)}
                          className="btn btn-secondary btn-sm"
                          title="Edit inspection (checks OCC version)"
                        >
                          <Edit size={13} />
                          <span>Edit</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Read Only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
