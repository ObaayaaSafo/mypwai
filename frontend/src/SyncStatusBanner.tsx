import React, { useEffect, useState } from 'react';
import { onSyncEvent, SyncEvent, getLastSyncTime, isSyncInProgress, syncToMySQL } from './offlineSync';

const SyncStatusBanner: React.FC = () => {
  const [status, setStatus] = useState<{
    type: 'idle' | 'syncing' | 'success' | 'error' | 'offline';
    message: string;
    lastSync: string | null;
  }>({
    type: 'idle',
    message: 'Sync idle',
    lastSync: null,
  });

  useEffect(() => {
    // Update status based on sync events
    const unsubscribe = onSyncEvent((event: SyncEvent) => {
      switch (event.type) {
        case 'sync-started':
          setStatus({
            type: 'syncing',
            message: '🔄 Syncing data to MySQL database...',
            lastSync: getLastSyncTime()?.toLocaleTimeString() || null,
          });
          break;
        case 'sync-completed':
          setStatus({
            type: 'success',
            message: event.details || '✅ All data synced to MySQL successfully',
            lastSync: event.timestamp.toLocaleTimeString(),
          });
          // Auto-hide success after 5 seconds
          setTimeout(() => {
            setStatus(prev => prev.type === 'success' ? { ...prev, type: 'idle', message: 'All data saved to MySQL' } : prev);
          }, 5000);
          break;
        case 'sync-skipped':
          setStatus({
            type: 'idle',
            message: 'Sync skipped (already in progress)',
            lastSync: getLastSyncTime()?.toLocaleTimeString() || null,
          });
          break;
        case 'sync-failed':
          setStatus({
            type: 'error',
            message: event.details || '❌ Failed to sync to MySQL',
            lastSync: getLastSyncTime()?.toLocaleTimeString() || null,
          });
          break;
        case 'backend-offline':
          setStatus({
            type: 'offline',
            message: '⚠️ Backend offline - data saved locally. Will sync when backend is available.',
            lastSync: getLastSyncTime()?.toLocaleTimeString() || null,
          });
          break;
        case 'backend-online':
          setStatus({
            type: 'idle',
            message: 'Backend is online',
            lastSync: getLastSyncTime()?.toLocaleTimeString() || null,
          });
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Style based on status type
  const getStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      bottom: '12px',
      left: '12px',
      zIndex: 9999,
      padding: '5px 12px',
      borderRadius: '8px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px',
      fontWeight: 500,
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      transition: 'all 0.3s ease',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      maxWidth: '320px',
    };

    switch (status.type) {
      case 'syncing':
        return { ...base, backgroundColor: '#1E3A5F', color: '#93C5FD', border: '1px solid #3B82F6' };
      case 'success':
        return { ...base, backgroundColor: '#134E4A', color: '#5EEAD4', border: '1px solid #0F766E' };
      case 'error':
        return { ...base, backgroundColor: '#7F1D1D', color: '#FCA5A5', border: '1px solid #DC2626' };
      case 'offline':
        return { ...base, backgroundColor: '#78350F', color: '#FCD34D', border: '1px solid #D97706' };
      default:
        return { ...base, backgroundColor: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' };
    }
  };

  // Only show during sync, errors, or when offline — hide when idle/normal
  if (status.type === 'idle') {
    return null;
  }

  return (
    <div className="sync-banner-enter" style={getStyle()}>
      {status.type === 'syncing' && (
        <span style={{
          width: '10px', height: '10px',
          border: '2px solid #3B82F6',
          borderTop: '2px solid transparent',
          borderRadius: '50%',
          animation: 'syncSpin 0.8s linear infinite',
          display: 'inline-block',
          flexShrink: 0,
        }} />
      )}
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status.message}</span>
      {status.lastSync && (
        <span style={{ opacity: 0.6, whiteSpace: 'nowrap', fontSize: '10px' }}>
          {status.lastSync}
        </span>
      )}
      {status.lastSync && (
        <button
          onClick={() => syncToMySQL()}
          disabled={isSyncInProgress()}
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            cursor: isSyncInProgress() ? 'not-allowed' : 'pointer',
            fontSize: '10px',
            fontWeight: 600,
            opacity: isSyncInProgress() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {isSyncInProgress() ? '...' : 'Sync'}
        </button>
      )}
      <style>{`
        @keyframes syncSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default SyncStatusBanner;
