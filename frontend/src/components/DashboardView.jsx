import React, { useState, useEffect } from 'react';
import {
  Wrench,
  ClipboardList,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  PlusCircle,
  Database,
  Shield,
  GitMerge,
  CloudOff,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api/client';
import { getCacheStats } from '../db/indexedDb';
import { useSync } from '../context/SyncContext';

export default function DashboardView({ onNavigate, onNewInspection }) {
  const { isOnline, isSyncing, outboxStats, triggerSync, lastSyncTime } = useSync();

  const [stats, setStats] = useState({
    equipmentCount: 0,
    inspectionCount: 0,
    passedCount: 0,
    warningFailCount: 0,
    pendingConflictCount: 0,
    recentInspections: [],
  });
  const [cacheStats, setCacheStats] = useState({ available: false, equipmentCount: 0, inspectionCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [equipData, inspData, conflictsData, cStats] = await Promise.all([
          api.getEquipmentList().catch(() => ({ equipment: [] })),
          api.getInspectionList().catch(() => ({ inspections: [] })),
          api.getConflictList({ status: 'pending' }).catch(() => ({ count: 0, conflicts: [] })),
          getCacheStats(),
        ]);

        const inspections = inspData.inspections || [];
        const equipment = equipData.equipment || [];
        const conflictCount = conflictsData.count ?? inspections.filter((i) => i.has_pending_conflict).length;

        const passed = inspections.filter((i) => i.overall_result === 'pass').length;
        const warningFail = inspections.filter((i) => i.overall_result === 'warning' || i.overall_result === 'fail').length;

        setStats({
          equipmentCount: equipment.length,
          inspectionCount: inspections.length,
          passedCount: passed,
          warningFailCount: warningFail,
          pendingConflictCount: conflictCount,
          recentInspections: inspections.slice(0, 5),
        });
        setCacheStats(cStats);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [lastSyncTime]);

  if (loading) {
    return (
      <div className="card loading-container">
        <div className="spinner" />
        <p>Loading operations dashboard...</p>
      </div>
    );
  }

  const pendingMutationsCount = (outboxStats?.pending || 0) + (outboxStats?.failed || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Welcome Banner */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#ffffff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Shield size={20} color="#60a5fa" />
              <span style={{ fontSize: '0.85rem', color: '#93c5fd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Offline-First Field Operations
              </span>
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '6px' }}>
              Equipment Maintenance & Inspection Command
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '640px' }}>
              SyncProof monitors equipment health and guarantees data integrity during field inspections using Optimistic Concurrency Control, three-way merge arbitration, and IndexedDB local caching.
            </p>
          </div>

          <button onClick={onNewInspection} className="btn btn-primary" style={{ backgroundColor: '#2563eb' }}>
            <PlusCircle size={16} />
            <span>Record Inspection</span>
          </button>
        </div>
      </div>

      {/* Actionable Banner for Concurrency Conflicts */}
      {stats.pendingConflictCount > 0 && (
        <div
          className="alert alert-danger"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <GitMerge size={22} color="#dc2626" />
            <div>
              <strong style={{ fontSize: '1rem' }}>
                {stats.pendingConflictCount} Concurrency Conflict{stats.pendingConflictCount > 1 ? 's' : ''} Require Arbitration
              </strong>
              <p style={{ fontSize: '0.85rem', marginTop: '2px', opacity: 0.9 }}>
                Concurrent edits on the same equipment inspection occurred during offline sync and need supervisor review.
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('conflicts')}
            className="btn btn-primary btn-sm"
            style={{ backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
          >
            <span>Open Review Queue</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid-cards">
        <div className="card stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('equipment')}>
          <div className="stat-icon blue">
            <Wrench size={24} />
          </div>
          <div>
            <div className="stat-value">{stats.equipmentCount}</div>
            <div className="stat-label">Active Equipment</div>
          </div>
        </div>

        <div className="card stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('inspections')}>
          <div className="stat-icon purple">
            <ClipboardList size={24} />
          </div>
          <div>
            <div className="stat-value">{stats.inspectionCount}</div>
            <div className="stat-label">Total Inspections</div>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon green">
            <CheckCircle size={24} />
          </div>
          <div>
            <div className="stat-value">{stats.passedCount}</div>
            <div className="stat-label">Passed Inspections</div>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon amber">
            <AlertTriangle size={24} />
          </div>
          <div>
            <div className="stat-value">{stats.warningFailCount}</div>
            <div className="stat-label">Warnings / Defects</div>
          </div>
        </div>

        <div
          className="card stat-card"
          style={{ cursor: 'pointer', borderColor: stats.pendingConflictCount > 0 ? '#fca5a5' : '#e2e8f0' }}
          onClick={() => onNavigate('conflicts')}
        >
          <div
            className="stat-icon"
            style={{
              backgroundColor: stats.pendingConflictCount > 0 ? '#fee2e2' : '#f1f5f9',
              color: stats.pendingConflictCount > 0 ? '#dc2626' : '#64748b',
            }}
          >
            <GitMerge size={24} />
          </div>
          <div>
            <div className="stat-value" style={{ color: stats.pendingConflictCount > 0 ? '#dc2626' : '#0f172a' }}>
              {stats.pendingConflictCount}
            </div>
            <div className="stat-label">Pending Conflicts</div>
          </div>
        </div>

        {/* Offline Outbox Queue Card */}
        <div className="card stat-card">
          <div
            className="stat-icon"
            style={{
              backgroundColor: pendingMutationsCount > 0 ? '#fef3c7' : '#dcfce7',
              color: pendingMutationsCount > 0 ? '#b45309' : '#15803d',
            }}
          >
            <CloudOff size={24} />
          </div>
          <div>
            <div className="stat-value" style={{ color: pendingMutationsCount > 0 ? '#b45309' : '#15803d' }}>
              {pendingMutationsCount}
            </div>
            <div className="stat-label">Outbox Pending Mutations</div>
          </div>
        </div>
      </div>

      {/* Local Storage Engine Diagnostics Card */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={18} color="#2563eb" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Client-Side IndexedDB Storage Engine</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`badge ${cacheStats.available ? 'badge-pass' : 'badge-fail'}`}>
              {cacheStats.available ? 'Browser Storage Active' : 'Storage Unavailable'}
            </span>
            <span className={`connectivity-pill ${isOnline ? 'online' : 'offline'}`}>
              <span className="connectivity-dot" />
              {isOnline ? 'Online Engine' : 'Offline Mode'}
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
          All equipment catalogs and inspection records fetched from the backend are cached directly inside your browser's persistent IndexedDB database. Offline creations and updates are held in the persistent outbox with guaranteed idempotency.
        </p>

        <div style={{ display: 'flex', gap: '24px', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: '#64748b' }}>Cached Equipment: </span>
            <strong style={{ color: '#0f172a' }}>{cacheStats.equipmentCount} records</strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Cached Inspections: </span>
            <strong style={{ color: '#0f172a' }}>{cacheStats.inspectionCount} records</strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Outbox Total: </span>
            <strong style={{ color: '#0f172a' }}>{outboxStats?.total || 0} queued</strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Outbox Synced: </span>
            <strong style={{ color: '#16a34a' }}>{outboxStats?.synced || 0} applied</strong>
          </div>
        </div>
      </div>

      {/* Recent Inspections Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Recent Inspections</h3>
          <button onClick={() => onNavigate('inspections')} className="btn btn-secondary btn-sm">
            View All Inspections
          </button>
        </div>

        {stats.recentInspections.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.9rem', padding: '16px 0' }}>No recent inspections recorded.</p>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Equipment Code</th>
                  <th>Equipment Name</th>
                  <th>Result</th>
                  <th>Version</th>
                  <th>Conflict</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentInspections.map((insp) => (
                  <tr key={insp.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{insp.equipment_code}</td>
                    <td>{insp.equipment_name}</td>
                    <td>
                      <span className={`badge badge-${insp.overall_result || 'warning'}`}>
                        {insp.overall_result || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-version">v{insp.version}</span>
                    </td>
                    <td>
                      {insp.has_pending_conflict ? (
                        <span className="badge badge-conflict">
                          <AlertTriangle size={11} /> Pending Review
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>Synced</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {new Date(insp.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
