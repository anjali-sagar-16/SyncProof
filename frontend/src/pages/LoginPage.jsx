import React, { useState } from 'react';
import { ShieldCheck, LogIn, AlertCircle, KeyRound, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickFill = (fillEmail, fillPass) => {
    setEmail(fillEmail);
    setPassword(fillPass);
    setError(null);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'inline-flex', padding: '12px', backgroundColor: '#eff6ff', borderRadius: '12px', color: '#2563eb', marginBottom: '12px' }}>
            <ShieldCheck size={36} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>SyncProof Portal</h1>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
            Industrial Equipment Inspection & Synchronization
          </p>
        </div>

        {error && (
          <div className="alert alert-danger">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Operator Email</label>
            <input
              type="email"
              placeholder="e.g. tech1@syncproof.internal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              autoComplete="email"
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px', padding: '10px' }}
            disabled={submitting}
          >
            <LogIn size={16} />
            <span>{submitting ? 'Verifying Credentials...' : 'Sign In'}</span>
          </button>
        </form>

        {/* Development Quick-Fill Helpers */}
        <div className="quick-logins">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <KeyRound size={13} />
            <span>Development Quick-Fill Accounts</span>
          </div>

          <div className="quick-login-grid">
            <button
              type="button"
              onClick={() => handleQuickFill('tech1@syncproof.internal', 'Technician123!')}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', justifyContent: 'flex-start' }}
            >
              <UserCheck size={12} color="#0284c7" />
              <span>Tech 1 (Alex R.)</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('tech2@syncproof.internal', 'Technician123!')}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', justifyContent: 'flex-start' }}
            >
              <UserCheck size={12} color="#0284c7" />
              <span>Tech 2 (Jordan L.)</span>
            </button>
          </div>

          <div style={{ marginTop: '6px' }}>
            <button
              type="button"
              onClick={() => handleQuickFill('supervisor@syncproof.internal', 'Supervisor123!')}
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', fontSize: '0.75rem', justifyContent: 'center' }}
            >
              <UserCheck size={12} color="#7c3aed" />
              <span>Supervisor (Morgan Davis)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
