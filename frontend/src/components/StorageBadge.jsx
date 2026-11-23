import React, { useState, useEffect } from 'react';
import { Database, AlertCircle } from 'lucide-react';
import { getCacheStats } from '../db/indexedDb';

export default function StorageBadge() {
  const [stats, setStats] = useState({ available: false, equipmentCount: 0, inspectionCount: 0 });
  const [loading, setLoading] = useState(true);

  const updateStats = async () => {
    try {
      const s = await getCacheStats();
      setStats(s);
    } catch {
      setStats({ available: false, equipmentCount: 0, inspectionCount: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    updateStats();
    // Periodically update cache statistics
    const interval = setInterval(updateStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <span className="storage-badge" style={{ backgroundColor: '#f1f5f9', color: '#64748b' }}>
        <Database size={13} /> Checking IndexedDB...
      </span>
    );
  }

  const totalCached = stats.equipmentCount + stats.inspectionCount;

  return (
    <span
      className={`storage-badge ${stats.available ? 'available' : 'unavailable'}`}
      title={
        stats.available
          ? `IndexedDB active: ${stats.equipmentCount} equipment, ${stats.inspectionCount} inspections cached locally`
          : 'IndexedDB is unavailable in this environment'
      }
    >
      {stats.available ? (
        <>
          <Database size={13} />
          <span>Local Storage: Ready ({totalCached} cached)</span>
        </>
      ) : (
        <>
          <AlertCircle size={13} />
          <span>Local Storage: Unavailable</span>
        </>
      )}
    </span>
  );
}
