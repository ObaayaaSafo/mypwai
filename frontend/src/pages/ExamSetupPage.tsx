import React, { useState, useEffect } from 'react';
import { fetchSessions, createSession, deleteSession, lockSession, unlockSession } from '../apiExtra';

const ExamSetupPage: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [form, setForm] = useState({ course: '', courseCode: '', date: '', time: '', hall: '' });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => localStorage.getItem('activeSessionId')
  );
  const [activeSessionLabel, setActiveSessionLabel] = useState<string>(() =>
    localStorage.getItem('activeSessionLabel') || ''
  );
  const userRole = localStorage.getItem('userRole');
  const username = localStorage.getItem('username') || 'unknown';

  useEffect(() => {
    loadSessions();
  }, []);

  // Sync active session to localStorage whenever it changes
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('activeSessionId', activeSessionId);
      localStorage.setItem('activeSessionLabel', activeSessionLabel);
    } else {
      localStorage.removeItem('activeSessionId');
      localStorage.removeItem('activeSessionLabel');
    }
  }, [activeSessionId, activeSessionLabel]);

  const loadSessions = async () => {
    const data = await fetchSessions();
    setSessions(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.course && form.courseCode && form.date && form.time && form.hall) {
      await createSession({ id: Date.now(), ...form });
      await loadSessions();
      setForm({ course: '', courseCode: '', date: '', time: '', hall: '' });
    }
  };

  const activateSession = async (session: any) => {
    const course = session.course || '';
    const courseCode = session.courseCode || session.course_code || '';
    const date = session.date || session.session_date || '';

    // Try to lock the session server-side
    try {
      const result = await lockSession(session.id, username, userRole || 'invigilator');
      if (!result.success) {
        alert(`This session is currently locked by ${result.lockedBy || 'another invigilator'}. Only the admin can override.`);
        return;
      }
    } catch {
      // If backend is unreachable, proceed anyway (offline mode)
    }

    setActiveSessionId(String(session.id));
    setActiveSessionLabel(`${courseCode} — ${course} (${date})`);
    localStorage.setItem('activeSessionCourse', course);
    localStorage.setItem('activeSessionCourseCode', courseCode);
    localStorage.setItem('activeSessionDate', date);
  };

  const deactivateSession = async () => {
    if (activeSessionId) {
      try {
        await unlockSession(Number(activeSessionId), username, userRole || 'invigilator');
      } catch { /* offline — ignore */ }
    }
    setActiveSessionId(null);
    setActiveSessionLabel('');
    localStorage.removeItem('activeSessionCourse');
    localStorage.removeItem('activeSessionCourseCode');
    localStorage.removeItem('activeSessionDate');
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this session?')) {
      if (String(id) === activeSessionId) {
        await deactivateSession();
      }
      await deleteSession(id);
      await loadSessions();
    }
  };

  return (
    <div className="page-enter" style={{
      minHeight: 'calc(100vh - 68px)',
      width: '100%',
      padding: '2rem'
    }}>
      <div className="card-accent-hover" style={{ width: '100%', maxWidth: 600, margin: '40px auto 0', background: 'var(--card)', borderRadius: 16, padding: '2.5rem 2rem', border: '1px solid var(--border)' }}>
        <h2 style={{ color: 'var(--accent)', marginBottom: 24, textAlign: 'center', fontWeight: 700 }}>Examination Setup</h2>

        {/* Only admin can create sessions */}
        {userRole === 'admin' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 32 }}>
            <input type="text" placeholder="Course Name" value={form.course} onChange={e => setForm({ ...form, course: e.target.value })} className="input" required />
            <input type="text" placeholder="Course Code" value={form.courseCode} onChange={e => setForm({ ...form, courseCode: e.target.value })} className="input" required />
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input" required />
            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="input" required />
            <input type="text" placeholder="Examination Hall" value={form.hall} onChange={e => setForm({ ...form, hall: e.target.value })} className="input" required />
            <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', fontSize: '1rem' }}>Create Session</button>
          </form>
        )}
        <div>
          <h3 style={{ color: 'var(--accent)', marginBottom: 12, fontWeight: 600 }}>Upcoming Sessions</h3>

          {/* Active Session Banner */}
          {activeSessionId && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(15,118,110,0.15), rgba(45,212,191,0.08))',
              border: '1px solid rgba(94,234,212,0.25)',
              borderRadius: '12px',
              padding: '0.75rem 1.25rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#5EEAD4', fontWeight: 600 }}>
                <span style={{
                  width: '10px', height: '10px',
                  borderRadius: '50%',
                  background: '#5EEAD4',
                  boxShadow: '0 0 8px rgba(94,234,212,0.5)',
                  animation: 'breathe 2.5s ease-in-out infinite',
                }} />
                <span>Active Session:</span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{activeSessionLabel}</span>
              </div>
              <button
                onClick={deactivateSession}
                className="btn-outline-action btn-outline-action--danger"
                style={{ fontSize: '0.8rem' }}
              >
                Deactivate
              </button>
            </div>
          )}

          {!activeSessionId && sessions.length > 0 && (
            <div style={{
              background: 'rgba(242,114,41,0.08)',
              border: '1px solid rgba(242,114,41,0.2)',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              color: '#F59E0B',
              fontSize: '0.85rem',
              fontWeight: 500,
              textAlign: 'center',
            }}>
              ⚠️ No active session. Select one below to scope attendance and reports.
            </div>
          )}

          <ul style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 18, listStyle: 'none', border: '1px solid var(--border)' }}>
            {sessions.length > 0 ? sessions.map(s => (
              <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                    {s.course || ''} ({s.courseCode || s.course_code || ''})
                    {String(s.id) === activeSessionId && (
                      <span style={{
                        marginLeft: '0.5rem',
                        padding: '1px 8px',
                        borderRadius: '999px',
                        background: 'rgba(94,234,212,0.2)',
                        color: '#5EEAD4',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                      }}>ACTIVE</span>
                    )}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{s.date || s.session_date || ''} at {s.time || s.session_time || ''} | {s.hall || ''}</div>
                  {s.created_at && (
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem', opacity: 0.7 }}>Created: {new Date(s.created_at).toLocaleDateString()}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  {String(s.id) !== activeSessionId && (
                    <button
                      onClick={() => activateSession(s)}
                      className="btn-outline-action"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    >
                      Activate
                    </button>
                  )}
                  {userRole === 'admin' && (
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="btn-outline-action btn-outline-action--danger"
                      style={{ fontSize: '0.8rem' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            )) : (
              <li style={{ textAlign: 'center', color: 'var(--muted)', padding: '1rem' }}>No sessions scheduled.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ExamSetupPage;
