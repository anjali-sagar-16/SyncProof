import React, { useState, useEffect } from 'react';
import { Search, Wrench, RefreshCw, AlertCircle, Eye, Database } from 'lucide-react';
import { api } from '../api/client';
import { saveEquipmentBatch, getAllEquipment } from '../db/indexedDb';

export default function EquipmentList({ onSelectEquipment }) {
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromCache, setFromCache] = useState(false);

  const fetchEquipment = async () => {
    setLoading(true);
    setError(null);
    setFromCache(false);

    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;

      const data = await api.getEquipmentList(params);
      setEquipment(data.equipment || []);

      // Cache records into IndexedDB
      if (data.equipment && data.equipment.length > 0) {
        saveEquipmentBatch(data.equipment).catch((err) =>
          console.warn('[Cache] Could not update IndexedDB cache:', err)
        );
      }
    } catch (err) {
      console.warn('[API] Fetch failed, attempting to read from IndexedDB cache...', err);
      // Fallback: Read from local IndexedDB cache
      try {
        const cached = await getAllEquipment();
        if (cached && cached.length > 0) {
          setEquipment(cached);
          setFromCache(true);
          setError('Network request failed. Displaying cached equipment from IndexedDB.');
        } else {
          setError(err.message || 'Failed to fetch equipment.');
        }
      } catch (cacheErr) {
        setError(err.message || 'Failed to fetch equipment.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEquipment();
  }, [statusFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchEquipment();
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wrench size={20} color="#2563eb" />
            <span>Industrial Equipment Catalog</span>
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Browse registered machinery, operational statuses, and maintenance logs.
          </p>
        </div>

        <button onClick={fetchEquipment} className="btn btn-secondary btn-sm" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', flex: 1, minWidth: '240px', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              placeholder="Search code, name, or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '36px' }}
            />
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '10px' }} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-select"
          style={{ width: 'auto', minWidth: '160px' }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="maintenance">Maintenance</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
      </div>

      {fromCache && (
        <div className="alert alert-warning">
          <Database size={16} />
          <span>Offline Fallback: Loaded {equipment.length} equipment items from local IndexedDB cache.</span>
        </div>
      )}

      {error && !fromCache && (
        <div className="alert alert-danger">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading equipment catalog...</p>
        </div>
      ) : equipment.length === 0 ? (
        <div className="loading-container" style={{ padding: '36px' }}>
          <p style={{ color: '#64748b' }}>No equipment matches the current search criteria.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Equipment Code</th>
                <th>Machinery Name</th>
                <th>Facility Location</th>
                <th>Serial Number</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
                      {item.code}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{item.name}</td>
                  <td>{item.location}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
                    {item.serial_number || 'N/A'}
                  </td>
                  <td>
                    <span className={`badge badge-${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => onSelectEquipment(item.id)}
                      className="btn btn-secondary btn-sm"
                      title="View details and inspections"
                    >
                      <Eye size={13} />
                      <span>Details</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
