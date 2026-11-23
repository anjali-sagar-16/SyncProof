import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wrench, ClipboardList, PlusCircle, GitMerge } from 'lucide-react';
import Navbar from '../components/Navbar';
import DashboardView from '../components/DashboardView';
import EquipmentList from '../components/EquipmentList';
import EquipmentDetail from '../components/EquipmentDetail';
import InspectionList from '../components/InspectionList';
import InspectionModal from '../components/InspectionModal';
import ConflictList from '../components/ConflictList';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function DashboardPage() {
  const { user, isSupervisor } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingConflictCount, setPendingConflictCount] = useState(0);

  // Modal State for Inspection Create/Edit
  const [modalState, setModalState] = useState({
    isOpen: false,
    inspection: null,
    preselectedEquipmentId: null,
  });

  // Query pending conflicts count periodically for badge
  useEffect(() => {
    let isMounted = true;
    const fetchPendingCount = async () => {
      try {
        const data = await api.getConflictList({ status: 'pending' });
        if (isMounted) {
          setPendingConflictCount(data.count || 0);
        }
      } catch {
        // Silently handle if offline
      }
    };

    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [refreshKey]);

  const handleNavigate = (tab) => {
    setActiveTab(tab);
    if (tab !== 'equipment') {
      setSelectedEquipmentId(null);
    }
  };

  const handleSelectEquipment = (equipId) => {
    setSelectedEquipmentId(equipId);
    setActiveTab('equipment');
  };

  const handleBackToEquipmentList = () => {
    setSelectedEquipmentId(null);
  };

  const handleOpenNewInspection = (equipId = null) => {
    setModalState({
      isOpen: true,
      inspection: null,
      preselectedEquipmentId: equipId,
    });
  };

  const handleOpenEditInspection = (inspection) => {
    setModalState({
      isOpen: true,
      inspection,
      preselectedEquipmentId: null,
    });
  };

  const handleCloseModal = () => {
    setModalState({
      isOpen: false,
      inspection: null,
      preselectedEquipmentId: null,
    });
  };

  const handleModalSuccess = () => {
    handleCloseModal();
    setRefreshKey((prev) => prev + 1);
  };

  const handleNavigateToConflicts = () => {
    setActiveTab('conflicts');
  };

  return (
    <div className="app-container">
      <Navbar onNavigate={handleNavigate} activeTab={activeTab} />

      <main className="main-content">
        {/* Navigation Tabs */}
        <div className="view-tabs" role="tablist" aria-label="Main Navigation">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'dashboard'}
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleNavigate('dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>Overview</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'equipment'}
            className={`tab-btn ${activeTab === 'equipment' ? 'active' : ''}`}
            onClick={() => handleNavigate('equipment')}
          >
            <Wrench size={18} />
            <span>Equipment Catalog</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inspections'}
            className={`tab-btn ${activeTab === 'inspections' ? 'active' : ''}`}
            onClick={() => handleNavigate('inspections')}
          >
            <ClipboardList size={18} />
            <span>Inspections</span>
          </button>

          {/* Supervisor & Review Conflict Tab */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'conflicts'}
            className={`tab-btn ${activeTab === 'conflicts' ? 'active' : ''}`}
            onClick={() => handleNavigate('conflicts')}
          >
            <GitMerge size={18} />
            <span>Conflict Review</span>
            {pendingConflictCount > 0 && (
              <span
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: '9999px',
                  marginLeft: '4px',
                }}
              >
                {pendingConflictCount}
              </span>
            )}
          </button>

          {user?.role === 'technician' && (
            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => handleOpenNewInspection()}
              >
                <PlusCircle size={16} />
                <span>New Inspection</span>
              </button>
            </div>
          )}
        </div>

        {/* View Switcher */}
        {activeTab === 'dashboard' && (
          <DashboardView
            key={`dashboard-${refreshKey}`}
            onNavigate={handleNavigate}
            onNewInspection={handleOpenNewInspection}
          />
        )}

        {activeTab === 'equipment' && (
          selectedEquipmentId ? (
            <EquipmentDetail
              key={`equipment-detail-${selectedEquipmentId}-${refreshKey}`}
              equipmentId={selectedEquipmentId}
              onBack={handleBackToEquipmentList}
              onNewInspection={(equipId) => handleOpenNewInspection(equipId)}
            />
          ) : (
            <EquipmentList
              key={`equipment-list-${refreshKey}`}
              onSelectEquipment={handleSelectEquipment}
            />
          )
        )}

        {activeTab === 'inspections' && (
          <InspectionList
            key={`inspections-${refreshKey}`}
            onNewInspection={handleOpenNewInspection}
            onEditInspection={handleOpenEditInspection}
            onNavigateToConflicts={handleNavigateToConflicts}
          />
        )}

        {activeTab === 'conflicts' && (
          <ConflictList
            key={`conflicts-${refreshKey}`}
            onConflictResolved={() => setRefreshKey((prev) => prev + 1)}
          />
        )}
      </main>

      {/* Modal Dialog */}
      {modalState.isOpen && (
        <InspectionModal
          inspection={modalState.inspection}
          preselectedEquipmentId={modalState.preselectedEquipmentId}
          onClose={handleCloseModal}
          onSuccess={handleModalSuccess}
        />
      )}
    </div>
  );
}
