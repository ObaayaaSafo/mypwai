import React, { useState, useEffect } from 'react';
import { fetchReports, fetchMalpracticeEvents, fetchMalpracticeSummary } from '../apiExtra';

const todayStr = () => new Date().toISOString().split('T')[0];

const ReportingPage: React.FC = () => {
  const userRole = localStorage.getItem('userRole');
  const activeSessionId = localStorage.getItem('activeSessionId');
  const activeSessionLabel = localStorage.getItem('activeSessionLabel') || '';

  // For admins: toggle between session-scoped and all-sessions view
  const [viewAllSessions, setViewAllSessions] = useState(false);
  const isAdmin = userRole === 'admin';

  const [filters, setFilters] = useState({ course: '', date: todayStr() });

  // ── Auto-populate filters from active session for invigilators ──
  React.useEffect(() => {
    if (!isAdmin && activeSessionId) {
      const storedCourseCode = localStorage.getItem('activeSessionCourseCode') || '';
      const storedDate = localStorage.getItem('activeSessionDate') || '';
      if (storedCourseCode || storedDate) {
        setFilters({ course: storedCourseCode, date: storedDate || todayStr() });
      }
    }
  }, []); // run once on mount
  const [reports, setReports] = useState<any[]>([]);
  const [malpracticeEvents, setMalpracticeEvents] = useState<any[]>([]);
  const [malpracticeSummary, setMalpracticeSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [error, setError] = useState('');
  const [showMalpractice, setShowMalpractice] = useState(true);

  const getEffectiveSessionId = () => {
    // For invigilators: always use the active session
    // For admins: only use active session when NOT viewing all sessions
    if (!isAdmin) return activeSessionId;
    return viewAllSessions ? null : activeSessionId;
  };

  const handleSearch = async (e: React.FormEvent, overrideAll?: boolean) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const sessionId = overrideAll === true ? null : getEffectiveSessionId();
      const [data, malpEvents, malpSummary] = await Promise.all([
        fetchReports(filters.course, filters.date, sessionId),
        fetchMalpracticeEvents(filters.course, filters.date, sessionId),
        fetchMalpracticeSummary(filters.course, filters.date, sessionId),
      ]);
      setReports(data);
      setMalpracticeEvents(malpEvents);
      setMalpracticeSummary(malpSummary);
      setSearched(true);
    } catch (err) {
      console.error(err);
      setError('Failed to load report. Make sure the backend is running.');
    }
    setLoading(false);
  };

  const handleViewToggle = (all: boolean) => {
    setViewAllSessions(all);
    setSearched(false);
    if (!all && activeSessionId) {
      // Read course info from dedicated localStorage keys
      const storedCourseCode = localStorage.getItem('activeSessionCourseCode') || '';
      const storedDate = localStorage.getItem('activeSessionDate') || '';
      if (storedCourseCode || storedDate) {
        setFilters({ course: storedCourseCode, date: storedDate || todayStr() });
      }
    }
  };

  const total = reports.length;
  const present = reports.filter(r => r.status === 'Present').length;
  const absent = reports.filter(r => r.status === 'Absent').length;
  const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

  const presentTimes = reports
    .filter(r => r.status === 'Present' && r.time && r.time !== '-')
    .map(r => r.time)
    .sort();
  const firstArrival = presentTimes.length > 0 ? presentTimes[0] : '-';
  const lastArrival = presentTimes.length > 0 ? presentTimes[presentTimes.length - 1] : '-';

  const displayedReports = reports.filter(r => {
    if (statusFilter === 'All') return true;
    return r.status === statusFilter;
  });

  const handleExport = () => {
    // Read course info from dedicated localStorage keys (set by ExamSetupPage)
    const storedCourse = localStorage.getItem('activeSessionCourse') || '';
    const storedCourseCode = localStorage.getItem('activeSessionCourseCode') || '';

    const courseName = storedCourse || '';
    const courseCode = storedCourseCode || filters.course || (reports.length > 0 && reports[0].courseCode) || '';

    const presentStudents = reports.filter(r => r.status === 'Present');
    const summaryRows = [
      ['Course Name', courseName],
      ['Course Code', courseCode],
      ['Date', filters.date],
      ['Generated', new Date().toLocaleString()],
      [''],
      ['Total Students', String(reports.length)],
      ['Present', String(presentStudents.length)],
      ['Absent', String(absent)],
      ['Attendance Rate', `${percentage}%`],
      [''],
    ];

    const escapeCSV = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const lines: string[] = [];
    for (const row of summaryRows) {
      lines.push(row.map(escapeCSV).join(','));
    }

    // Column headers
    lines.push(['Student ID', 'Name', 'Status', 'Time'].map(escapeCSV).join(','));

    for (const r of reports) {
      lines.push([
        escapeCSV(r.studentId || ''),
        escapeCSV(r.name || ''),
        escapeCSV(r.status || ''),
        escapeCSV(r.time || ''),
      ].join(','));
    }

    const csvContent = lines.join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const filename = courseCode ? `attendance_${courseCode}_${filters.date}.csv` : `attendance_report_${filters.date}.csv`;
    link.download = filename;
    link.click();
  };

  // Determines the scope label for display
  const getScopeLabel = () => {
    if (isAdmin && viewAllSessions) return 'All Sessions';
    if (activeSessionId) return activeSessionLabel;
    return 'No Session Selected';
  };

  return (
    <div className="page-enter" style={{ minHeight: 'calc(100vh - 68px)', width: '100%' }}>
      <div className="page-container">
      <style>{`
        @media print {
          .navbar, .no-print { display: none !important; }
          body { background-color: white !important; }
          .print-container { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
        }
      `}</style>
      <h2 className="animate-fade-in-up" style={{ marginBottom: '0.5rem', color: 'var(--accent)' }}>Attendance Reports</h2>

      {/* Scope Banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        marginBottom: '1.25rem', flexWrap: 'wrap',
      }}>
        {/* Session scope badge */}
        <div style={{
          background: isAdmin && viewAllSessions
            ? 'rgba(59,130,246,0.12)'
            : activeSessionId
              ? 'linear-gradient(135deg, rgba(15,118,110,0.15), rgba(45,212,191,0.08))'
              : 'rgba(242,114,41,0.08)',
          border: isAdmin && viewAllSessions
            ? '1px solid rgba(59,130,246,0.25)'
            : activeSessionId
              ? '1px solid rgba(94,234,212,0.25)'
              : '1px solid rgba(242,114,41,0.2)',
          borderRadius: '999px',
          padding: '0.35rem 1rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: isAdmin && viewAllSessions ? '#93C5FD' : activeSessionId ? '#5EEAD4' : '#F59E0B',
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: isAdmin && viewAllSessions ? '#3B82F6' : activeSessionId ? '#5EEAD4' : '#F59E0B',
            boxShadow: `0 0 6px ${isAdmin && viewAllSessions ? '#3B82F6' : activeSessionId ? '#5EEAD4' : '#F59E0B'}`,
          }} />
          {getScopeLabel()}
        </div>

        {/* Admin: toggle All Sessions / My Session */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--input-bg)', borderRadius: '999px', padding: '2px' }}>
            <button
              onClick={() => handleViewToggle(false)}
              style={{
                padding: '0.35rem 0.9rem',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: !viewAllSessions ? 'var(--card-solid)' : 'transparent',
                color: !viewAllSessions ? 'var(--text)' : 'var(--muted)',
                transition: 'all 0.2s',
              }}
            >
              My Session
            </button>
            <button
              onClick={() => handleViewToggle(true)}
              style={{
                padding: '0.35rem 0.9rem',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: viewAllSessions ? 'var(--card-solid)' : 'transparent',
                color: viewAllSessions ? 'var(--text)' : 'var(--muted)',
                transition: 'all 0.2s',
              }}
            >
              All Sessions
            </button>
          </div>
        )}

        {/* Invigilator: no session warning */}
        {!isAdmin && !activeSessionId && (
          <span style={{ color: '#F59E0B', fontSize: '0.8rem', fontWeight: 500 }}>
            Go to <strong>Exams</strong> to select a session first.
          </span>
        )}
      </div>
      
      <form className="no-print card card-accent-hover" onSubmit={handleSearch} style={{ padding: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Course Code <span style={{fontWeight:400, color:'var(--muted)'}}>(optional)</span></label>
          <input type="text" value={filters.course} placeholder="e.g. CSC101" onChange={e => setFilters({...filters, course: e.target.value})} className="input" style={{ width: '100%' }} disabled={!viewAllSessions && !!activeSessionId} />
        </div>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Date</label>
          <input type="date" value={filters.date} onChange={e => setFilters({...filters, date: e.target.value})} className="input" style={{ width: '100%' }} disabled={!viewAllSessions && !!activeSessionId} />
        </div>
        <button type="submit" disabled={loading} className="btn btn-secondary">{loading ? 'Loading...' : 'Generate Report'}</button>
      </form>

      {error && <div style={{ color: '#FCA5A5', background: '#7F1D1D', padding: '0.75rem', borderRadius: '12px', marginBottom: '1.25rem' }}>{error}</div>}

      {searched && (
        <>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontSize: '1.05rem', color: 'var(--text)' }}>
            {filters.course ? (
              <>Report for <strong>{filters.course}</strong> on <strong>{new Date(filters.date).toLocaleDateString()}</strong></>
            ) : (
              <>Report for <strong>{new Date(filters.date).toLocaleDateString()}</strong> — All Courses</>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={handleExport}>Export Text</button>
            <button className="btn" onClick={() => window.print()}>Print Report</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>Total Students</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text)' }}>{total}</div>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>Present</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#5EEAD4' }}>{present}</div>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>Absent</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FCA5A5' }}>{absent}</div>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>Attendance Rate</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>{percentage}%</div>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>First Arrival</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#5EEAD4' }}>{firstArrival}</div>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 700 }}>Last Arrival</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#FCD34D' }}>{lastArrival}</div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem', background: 'var(--border)', borderRadius: '9999px', height: '24px', overflow: 'hidden', display: 'flex' }}>
          <div style={{ 
            width: `${percentage}%`, 
            background: 'var(--upsa-success)',
            height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.8rem', fontWeight: 'bold',
            transition: 'width 0.5s ease-in-out'
          }}>{percentage > 5 && `${percentage}%`}</div>
          <div style={{ 
            width: `${100 - percentage}%`, 
            background: 'var(--upsa-danger)',
            height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.8rem', fontWeight: 'bold',
            transition: 'width 0.5s ease-in-out'
          }}>{(100 - percentage) > 5 && `${100 - percentage}%`}</div>
        </div>

        <div className="card-accent-hover" style={{ background: 'var(--card)', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div className="no-print" style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '0.5rem' }}>Filter:</span>
            {['All', 'Present', 'Absent'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{
                  padding: '0.4rem 1rem',
                  borderRadius: '9999px',
                  border: '1px solid ' + (statusFilter === status ? 'var(--accent)' : 'var(--border)'),
                  background: statusFilter === status ? 'var(--accent)' : 'transparent',
                  color: statusFilter === status ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  transition: 'all 0.2s'
                }}
              >
                {status}
              </button>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '2px solid var(--border)' }}>
              <tr>
                <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)' }}>Student ID</th>
                <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)' }}>Name</th>
                <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {displayedReports.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem' }}>{r.studentId}</td>
                  <td style={{ padding: '1rem' }}>{r.name}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem', background: r.status === 'Present' ? '#134E4A' : '#7F1D1D', color: r.status === 'Present' ? '#5EEAD4' : '#FCA5A5' }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>{r.time}</td>
                </tr>
              ))}
              {displayedReports.length === 0 && <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No records found. Try generating a report first.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Malpractice Section */}
        {malpracticeEvents.length > 0 && (
          <>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0, color: '#FCA5A5', fontSize: '1.3rem' }}>Malpractice Incidents</h3>
            <button onClick={() => setShowMalpractice(!showMalpractice)} className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
              {showMalpractice ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {malpracticeSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', margin: '1rem 0' }}>
              <div className="card-accent-hover" style={{ background: '#7F1D1D20', border: '1px solid #7F1D1D40', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#FCA5A5', fontWeight: 700 }}>Total Incidents</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FCA5A5' }}>{malpracticeSummary.totalEvents}</div>
              </div>
              <div className="card-accent-hover" style={{ background: '#7F1D1D20', border: '1px solid #7F1D1D40', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#FCA5A5', fontWeight: 700 }}>High Severity</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#EF4444' }}>{malpracticeSummary.bySeverity?.high || 0}</div>
              </div>
              <div className="card-accent-hover" style={{ background: '#7F1D1D20', border: '1px solid #7F1D1D40', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#FCA5A5', fontWeight: 700 }}>Medium Severity</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#F59E0B' }}>{malpracticeSummary.bySeverity?.medium || 0}</div>
              </div>
              <div className="card-accent-hover" style={{ background: '#7F1D1D20', border: '1px solid #7F1D1D40', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#FCA5A5', fontWeight: 700 }}>Low Severity</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#10B981' }}>{malpracticeSummary.bySeverity?.low || 0}</div>
              </div>
              {malpracticeSummary.topTypes?.slice(0, 3).map(([type, count]: [string, number]) => (
                <div key={type} className="card-accent-hover" style={{ background: '#7F1D1D20', border: '1px solid #7F1D1D40', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: '#FCA5A5', fontWeight: 700, textTransform: 'capitalize' }}>{type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#FCD34D' }}>{count}</div>
                </div>
              ))}
            </div>
          )}

          {showMalpractice && (
            <div className="card-accent-hover" style={{ background: 'var(--card)', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: '2rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(127,29,29,0.15)', borderBottom: '2px solid rgba(248,113,113,0.3)' }}>
                  <tr>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Student</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Type</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Severity</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Score</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Time</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#FCA5A5' }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {malpracticeEvents.map((e: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text)' }}>
                        {e.studentName} {e.studentId ? `(${e.studentId})` : ''}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', background: 'rgba(148,163,184,0.15)', color: '#E2E8F0', textTransform: 'capitalize' }}>
                          {e.eventType?.replace(/_/g, ' ') || 'unknown'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem',
                          background: e.severity === 'high' ? '#7F1D1D' : e.severity === 'medium' ? '#78350F' : '#134E4A',
                          color: e.severity === 'high' ? '#FCA5A5' : e.severity === 'medium' ? '#FCD34D' : '#5EEAD4'
                        }}>
                          {e.severity}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>{e.score}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>{e.time}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontSize: '0.85rem', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </>
        )}
        </>
      )}
      </div>
    </div>
  );
};
export default ReportingPage;
