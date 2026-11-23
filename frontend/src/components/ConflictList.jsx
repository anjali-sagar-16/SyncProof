import React, { useState, useEffect } from 'react';
import { GitMerge, RefreshCw, CheckCircle, AlertTriangle, ArrowRight, ShieldCheck, User } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ConflictResolutionModal from './ConflictResolutionModal';

export default function ConflictList({ onConflictResolved }) {
  const { isSupervisor } = useAuth();
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedConflict, setSelectedConflict] = useState(null);

  const fetchConflicts = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {};
      if (statusFilter && statusFilter !== 'all') {
        params.status = statusFilter;
      }
      const data = await api.getConflictList(params);
      setConflicts(data.conflicts || []);
    } catch (err) {
      console.error('[Conflicts] Fetch error:', err);
      setError(err.message || 'Failed to fetch conflicts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConflicts();
  }, [statusFilter]);

  const handleOpenResolve = (conflict) => {
    setSelectedConflict(conflict);
  };

  const handleCloseResolve = () => {
    setSelectedConflict(null);
  };

  const handleResolveSuccess = () => {
    handleCloseResolve();
    fetchConflicts();
    if (onConflictResolved) {
      onConflictResolved();
    }
  };

  const pendingCount = conflicts.filter((c) => c.status === 'pending').length;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitMerge size={20} color="#ea580c" />
            <span>Concurrent Edit Conflicts & Review Queue</span>
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Three-way synchronization collisions requiring human-in-the-loop arbitration.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchConflicts} className="btn btn-secondary btn-sm" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-select"
          style={{ width: 'auto', minWidth: '180px' }}
        >
          <option value="pending">Pending Review</option>
          <option value="resolved">Resolved Conflicts</option>
          <option value="all">All Conflicts</option>
        </select>

        {statusFilter === 'pending' && (
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            <strong>{pendingCount}</strong> item{pendingCount === 1 ? '' : 's'} waiting for supervisor resolution
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-danger">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading conflict queue...</p>
        </div>
      ) : conflicts.length === 0 ? (
        <div className="loading-container" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <ShieldCheck size={36} color="#16a34a" style={{ marginBottom: '8px' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
            No Active Concurrency Conflicts
          </h3>
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '4px', maxWidth: '420px' }}>
            All field inspections are cleanly synchronized or have already been arbitrated by supervisors.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Technician</th>
                <th>Version Shift</th>
                <th>Conflicting Fields</th>
                <th>Status</th>
                <th>Detected At</th>
                {statusFilter !== 'pending' && <th>Resolved Info</th>}
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((conf) => {
                const fields = Array.isArray(conf.conflicting_fields)
                  ? conf.conflicting_fields
                  : (typeof conf.conflicting_fields === 'string' ? JSON.parse(conf.conflicting_fields) : []);

                const isPending = conf.status === 'pending';

                return (
                  <tr key={conf.id}>
                    <td>
                      <div>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
                          {conf.equipment_code}
                        </span>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {conf.equipment_name}
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <User size={14} color="#64748b" />
                        <span style={{ fontWeight: 600 }}>{conf.technician_name}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{conf.technician_email}</div>
                    </td>

                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        v{conf.base_version} <ArrowRight size={10} style={{ display: 'inline' }} /> v{conf.server_version}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {fields.map((f) => (
                          <span key={f} className="badge badge-conflict" style={{ fontSize: '0.7rem' }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td>
                      <span className={`badge ${isPending ? 'badge-warning' : 'badge-pass'}`}>
                        {isPending ? 'Pending Review' : 'Resolved'}
                      </span>
                    </td>

                    <td style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {new Date(conf.created_at).toLocaleString()}
                    </td>

                    {statusFilter !== 'pending' && (
                      <td style={{ fontSize: '0.78rem' }}>
                        {conf.resolver_name ? (
                          <div>
                            <span style={{ fontWeight: 600 }}>{conf.resolver_name}</span>
                            <div style={{ color: '#64748b' }}>
                              {conf.resolved_at ? new Date(conf.resolved_at).toLocaleDateString() : ''}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}

                    <td style={{ textAlign: 'right' }}>
                      {isPending && isSupervisor ? (
                        <button
                          onClick={() => handleOpenResolve(conf)}
                          className="btn btn-primary btn-sm"
                          style={{ backgroundColor: '#ea580c', borderColor: '#c2410c' }}
                        >
                          <GitMerge size={13} />
                          <span>Resolve</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenResolve(conf)}
                          className="btn btn-secondary btn-sm"
                          title="View 3-way conflict details"
                        >
                          <span>Inspect</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedConflict && (
        <ConflictResolutionModal
          conflict={selectedConflict}
          onClose={handleCloseResolve}
          onSuccess={handleResolveSuccess}
        />
      )}
    </div>
  );
}
