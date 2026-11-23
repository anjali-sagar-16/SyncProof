/**
 * API Client for SyncProof REST API
 * Handles token authorization headers and structured error responses.
 */

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '/api';

function getAuthHeader() {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('syncproof_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  // Authentication
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: () => request('/auth/me'),

  getHealth: () => request('/health'),

  // Equipment
  getEquipmentList: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/equipment${query ? `?${query}` : ''}`);
  },

  getEquipmentDetail: (id) => request(`/equipment/${id}`),

  // Inspections
  getInspectionList: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/inspections${query ? `?${query}` : ''}`);
  },

  getInspectionDetail: (id) => request(`/inspections/${id}`),

  createInspection: (payload) =>
    request('/inspections', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateInspection: (id, payload) =>
    request(`/inspections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Synchronization API (Batch offline mutations)
  sync: (mutations) =>
    request('/sync', {
      method: 'POST',
      body: JSON.stringify({ mutations }),
    }),

  // Conflict Resolution APIs
  getConflictList: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/conflicts${query ? `?${query}` : ''}`);
  },

  getConflictDetail: (id) => request(`/conflicts/${id}`),

  resolveConflict: (id, payload) =>
    request(`/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
