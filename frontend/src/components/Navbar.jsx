import React, { useState } from 'react';
import { ShieldCheck, LogOut, User, Wifi, WifiOff, RefreshCw, CloudOff, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import StorageBadge from './StorageBadge';
import OutboxModal from './OutboxModal';

export default function Navbar({ onNavigate, activeTab, currentView, onViewChange }) {
  const { user, logout, isSupervisor } = useAuth();
  const { isOnline, isSimulatedOffline, isSyncing, pendingCount, triggerSync, toggleSimulatedOffline } = useSync();
  const [showOutboxModal, setShowOutboxModal] = useState(false);

  const navigateTo = onNavigate || onViewChange || (() => {});
  const currentTab = activeTab || currentView || 'dashboard';

  const handleManualSync = async () => {
    try {
      await triggerSync();
    } catch (e) {
      console.warn('Manual sync error:', e);
    }
  };

  return (
    <>
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('dashboard');
            }}
            className="nav-brand"
          >
            <ShieldCheck size={28} />
            <span>SyncProof</span>
          </a>
          <span className="nav-tagline">Equipment Inspections</span>
        </div>

        <div className="nav-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Connectivity Status with Simulated Toggle */}
          <button
            type="button"
            onClick={toggleSimulatedOffline}
            className={`connectivity-pill ${isOnline ? 'online' : 'offline'}`}
            style={{ border: 'none', cursor: 'pointer' }}
            title={
              isSimulatedOffline
                ? 'Simulated Offline Mode Active (Click to go Online)'
                : isOnline
                ? 'Online Engine Active (Click to simulate Offline Mode)'
                : 'Network Disconnected'
            }
          >
            <span className="connectivity-dot" />
            {isOnline ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Wifi size={12} /> Online
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <WifiOff size={12} /> Offline
              </span>
            )}
          </button>

          {/* Pending Sync Outbox Indicator */}
          <button
            type="button"
            onClick={() => setShowOutboxModal(true)}
            className="btn btn-secondary btn-sm"
            style={{
              padding: '3px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: pendingCount > 0 ? '#fef3c7' : '#f1f5f9',
              color: pendingCount > 0 ? '#b45309' : '#475569',
              borderColor: pendingCount > 0 ? '#fde68a' : '#cbd5e1',
            }}
            title="Inspect offline mutation outbox queue"
          >
            <Inbox size={13} />
            <span>{pendingCount > 0 ? `${pendingCount} Queued` : 'Outbox'}</span>
          </button>

          {/* Manual Batch Sync Trigger */}
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing || !isOnline}
            className="btn btn-secondary btn-sm"
            style={{ padding: '4px 8px' }}
            title="Trigger batch synchronization with server"
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
            <span style={{ fontSize: '0.75rem' }}>{isSyncing ? 'Syncing...' : 'Sync'}</span>
          </button>

          {/* Local IndexedDB storage status indicator */}
          <StorageBadge />

          {/* User profile badge */}
          <div className="user-badge">
            <User size={15} color="#475569" />
            <span style={{ fontWeight: 600 }}>{user?.fullName || user?.email}</span>
            <span className={`role-pill ${isSupervisor ? 'supervisor' : 'technician'}`}>
              {user?.role}
            </span>
          </div>

          {/* Logout action */}
          <button
            onClick={logout}
            className="btn btn-secondary btn-sm"
            title="Sign out of SyncProof"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Outbox Queue Modal */}
      {showOutboxModal && (
        <OutboxModal onClose={() => setShowOutboxModal(false)} />
      )}
    </>
  );
}
