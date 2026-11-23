import React, { useState, useEffect } from 'react';
import { ArrowLeft, PlusCircle, Wrench, Calendar, MapPin, Hash, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import { getEquipmentById, saveEquipment } from '../db/indexedDb';

export default function EquipmentDetail({ equipmentId, onBack, onNewInspection }) {
  const [equipment, setEquipment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadEquipment() {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getEquipmentDetail(equipmentId);
        if (isMounted) {
          setEquipment(data.equipment);
          saveEquipment(data.equipment).catch(() => {});
        }
      } catch (err) {
        // Fallback to local cache
        try {
          const cached = await getEquipmentById(equipmentId);
          if (cached && isMounted) {
            setEquipment(cached);
          } else if (isMounted) {
            setError(err.message || 'Failed to load equipment details.');
          }
        } catch {
          if (isMounted) setError(err.message || 'Failed to load equipment details.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadEquipment();
    return () => { isMounted = false; };
  }, [equipmentId]);

  if (loading) {
    return (
      <div className="card loading-container">
        <div className="spinner" />
        <p>Loading equipment specifications...</p>
      </div>
    );
  }

  if (error || !equipment) {
    return (
      <div className="card">
        <div className="alert alert-danger">{error || 'Equipment not found.'}</div>
        <button onClick={onBack} className="btn btn-secondary btn-sm">
          <ArrowLeft size={14} /> Back to Catalog
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Bar Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} className="btn btn-secondary btn-sm">
          <ArrowLeft size={14} />
          <span>Back to Equipment List</span>
        </button>

        <button
          onClick={() => onNewInspection(equipment.id)}
          className="btn btn-primary btn-sm"
        >
          <PlusCircle size={14} />
          <span>New Inspection for this Machine</span>
        </button>
      </div>

      {/* Equipment Specification Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'monospace', color: '#2563eb', backgroundColor: '#eff6ff', padding: '2px 8px', borderRadius: '4px' }}>
                {equipment.code}
              </span>
              <span className={`badge badge-${equipment.status}`}>{equipment.status}</span>
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{equipment.name}</h1>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={13} /> Location
            </span>
            <p style={{ fontWeight: 600 }}>{equipment.location}</p>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Hash size={13} /> Serial Number
            </span>
            <p style={{ fontWeight: 600, fontFamily: 'monospace' }}>{equipment.serial_number || 'N/A'}</p>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={13} /> Registered Date
            </span>
            <p style={{ fontWeight: 600 }}>{new Date(equipment.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* Recent Inspection History Card */}
      <div className="card">
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Wrench size={18} color="#2563eb" />
          <span>Recent Inspection History</span>
        </h3>

        {!equipment.recentInspections || equipment.recentInspections.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>No previous inspection records for this machinery.</p>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Status</th>
                  <th>OCC Version</th>
                  <th>Inspector</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {equipment.recentInspections.map((insp) => (
                  <tr key={insp.id}>
                    <td>
                      <span className={`badge badge-${insp.overall_result || 'warning'}`}>
                        {insp.overall_result || 'N/A'}
                      </span>
                    </td>
                    <td><span style={{ textTransform: 'capitalize' }}>{insp.status}</span></td>
                    <td><span className="badge badge-version">v{insp.version}</span></td>
                    <td>{insp.inspector_name || 'Inspector'}</td>
                    <td>{new Date(insp.created_at).toLocaleString()}</td>
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
