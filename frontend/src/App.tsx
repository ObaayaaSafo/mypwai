import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import { useLocation } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import LoginPage from './components/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StudentManagementPage from './pages/StudentManagementPage';
import FingerprintEnrollmentPage from './pages/FingerprintEnrollmentPage';
import ExamSetupPage from './pages/ExamSetupPage';
import AttendancePage from './pages/AttendancePage';
import MonitoringPage from './pages/MonitoringPage';
import ReportingPage from './pages/ReportingPage';
import SignInPage from './pages/SignInPage';
import AdminInvigilatorsPage from './pages/AdminInvigilatorsPage';
import SyncStatusBanner from './SyncStatusBanner';
import { startPeriodicSync, stopPeriodicSync } from './offlineSync';
import { validateAuthSession } from './apiExtra';

const ProtectedRoute = ({ children }: { children: React.ReactElement }) => {
  const isAuthenticated = localStorage.getItem('authToken');
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const AdminRoute = ({ children }: { children: React.ReactElement }) => {
  const isAuthenticated = localStorage.getItem('authToken');
  const role = localStorage.getItem('userRole');
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

function AppContent() {
  // Use location to conditionally render Navbar
  const location = useLocation();
  const isFullScreen = ['/', '/login'].includes(location.pathname);
  const authToken = localStorage.getItem('authToken');
  const [sessionState, setSessionState] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    authToken ? 'checking' : 'unauthenticated'
  );

  useEffect(() => {
    let cancelled = false;

    if (!authToken) {
      setSessionState('unauthenticated');
      return;
    }

    setSessionState('checking');
    validateAuthSession()
      .then(() => {
        if (!cancelled) {
          setSessionState('authenticated');
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          const message = err?.message || '';
          // Only clear auth on explicit token-invalid errors (401, 403, expired, etc.)
          // Network/server errors (backend down) — keep the token and let the user in
          const isExplicitAuthError = /invalid token|token expired|authentication failed|unauthorized|no token provided/i.test(message);
          if (isExplicitAuthError) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('username');
            localStorage.removeItem('email');
            setSessionState('unauthenticated');
          } else {
            // Backend unreachable or server error — trust the existing session
            setSessionState('authenticated');
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  // Start periodic sync when user is authenticated
  useEffect(() => {
    if (sessionState === 'authenticated') {
      startPeriodicSync();
      return () => stopPeriodicSync();
    }
  }, [sessionState]);

  if (sessionState === 'checking') {
    return (
      <div className="app-shell" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ padding: '1rem 1.5rem', borderRadius: 16, background: 'rgba(255,255,255,0.92)', boxShadow: '0 8px 24px rgba(37,99,235,0.12)' }}>
          Verifying session...
        </div>
      </div>
    );
  }

  return (
    <>
      {!isFullScreen && <Navbar />}
      <div className={isFullScreen ? 'app-shell app-shell--full' : 'app-shell page-enter'} style={isFullScreen ? { padding: 0 } : { padding: '1.25rem', minHeight: '100vh', background: 'transparent' }}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/login" element={<SignInPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/students" element={<AdminRoute><StudentManagementPage /></AdminRoute>} />
          <Route path="/enroll" element={<AdminRoute><FingerprintEnrollmentPage /></AdminRoute>} />
          <Route path="/exam-setup" element={<ProtectedRoute><ExamSetupPage /></ProtectedRoute>} />
          <Route path="/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
          <Route path="/monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
          <Route path="/reporting" element={<ProtectedRoute><ReportingPage /></ProtectedRoute>} />
          <Route path="/invigilators" element={<AdminRoute><AdminInvigilatorsPage /></AdminRoute>} />
        </Routes>
      </div>
      {sessionState === 'authenticated' && <SyncStatusBanner />}
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppContent />
      </Router>
    </ThemeProvider>
  );
}

export default App;

