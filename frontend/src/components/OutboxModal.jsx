import React from 'react';
import { X, RefreshCw, Trash2, CheckCircle2, Clock, AlertTriangle, CloudOff, ArrowUpRight } from 'lucide-react';
import { useSync } from '../context/SyncContext';
import { clearSyncedMutations } from '../db/indexedDb';

export default function OutboxModal({ onClose }) {
  const { outboxItems, isSyncing, triggerSync, refreshOutbox, isOnline, toggleSimulatedOffline, isSimulatedOffline } = useSync();

  const handleClearSynced = async () => {
    await clearSyncedMutations();
    await refreshOutbox();
  };

  const handleManualSync = async () => {
    try {
      await triggerSync();
    } catch {
      // Handled in context
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '820px', width: '95%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CloudOff size={20} color="#2563eb" />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              Offline Mutation Outbox Queue
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Outbox Status Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className={`connectivity-pill ${isOnline ? 'online' : 'offline'}`}>
                <span className="connectivity-dot" />
                {isOnline ? 'Online Engine' : 'Offline Engine'}
              </span>
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {outboxItems.length} mutation{outboxItems.length === 1 ? '' : 's'} recorded locally in IndexedDB
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={toggleSimulatedOffline}
                className="btn btn-secondary btn-sm"
                title="Toggle simulated offline state for live demonstration"
              >
                {isSimulatedOffline ? 'Resume Online' : 'Simulate Offline'}
              </button>

              <button
                type="button"
                onClick={handleManualSync}
                className="btn btn-primary btn-sm"
                disabled={isSyncing || !isOnline}
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Batch Now'}</span>
              </button>

              <button
                type="button"
                onClick={handleClearSynced}
                className="btn btn-secondary btn-sm"
                title="Purge applied mutations from local outbox"
              >
                <Trash2 size={13} />
                <span>Clear Synced</span>
              </button>
            </div>
          </div>

          {outboxItems.length === 0 ? (
            <div className="loading-container" style={{ padding: '36px 16px', textAlign: 'center' }}>
              <CheckCircle2 size={36} color="#16a34a" style={{ marginBottom: '8px' }} />
              <p style={{ fontWeight: 600, color: '#1e293b' }}>Outbox is Completely Synchronized</p>
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                No pending or uncommitted mutations waiting in local browser storage.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Client Mutation ID</th>
                    <th>Target Entity</th>
                    <th>OCC Base</th>
                    <th>Retry</th>
                    <th>Queued At</th>
                  </tr>
                </thead>
                <tbody>
                  {outboxItems.map((item) => {
                    let badgeClass = 'badge-status-pending';
                    if (item.status === 'syncing') badgeClass = 'badge-status-syncing';
                    if (item.status === 'synced') badgeClass = 'badge-status-synced';
                    if (item.status === 'failed') badgeClass = 'badge-status-failed';
                    if (item.status === 'conflicted') badgeClass = 'badge-status-conflicted';

                    return (
                      <tr key={item.id}>
                        <td>
                          <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', color: item.action === 'create' ? '#16a34a' : '#2563eb' }}>
                            {item.action}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`}>
                            {item.status}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#475569' }} title={item.clientMutationId}>
                            {item.clientMutationId.slice(0, 8)}...
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: '#1e293b' }}>
                            {item.action === 'create' ? 'New Inspection' : `Insp #${item.entityId.slice(0, 8)}`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            v{item.baseVersion || 1}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: item.retryCount > 0 ? '#b91c1c' : '#64748b' }}>
                            {item.retryCount || 0}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {new Date(item.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
