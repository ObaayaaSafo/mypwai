import React, { useState } from 'react';
import { fetchReports, fetchMalpracticeEvents, fetchMalpracticeSummary } from '../apiExtra';

const todayStr = () => new Date().toISOString().split('T')[0];

const ReportingPage: React.FC = () => {
  const [filters, setFilters] = useState({ course: '', date: todayStr() });
  const [reports, setReports] = useState<any[]>([]);
  const [malpracticeEvents, setMalpracticeEvents] = useState<any[]>([]);
  const [malpracticeSummary, setMalpracticeSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [error, setError] = useState('');
  const [showMalpractice, setShowMalpractice] = useState(true);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const [data, malpEvents, malpSummary] = await Promise.all([
        fetchReports(filters.course, filters.date),
        fetchMalpracticeEvents(filters.course, filters.date),
        fetchMalpracticeSummary(filters.course, filters.date),
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
    const reportLines: string[] = [];
    
    reportLines.push('='.repeat(62));
    reportLines.push('  ATTENDANCE REPORT');
    reportLines.push('='.repeat(62));
    reportLines.push(`  Course: ${filters.course || 'ALL'}     Date: ${filters.date}`);
    reportLines.push(`  Generated: ${new Date().toLocaleString()}`);
    reportLines.push('');
    
    reportLines.push('  SUMMARY');
    reportLines.push('  ' + '-'.repeat(20));
    reportLines.push(`  Total Students:    ${reports.length}`);
    reportLines.push(`  Present:           ${present}`);
    reportLines.push(`  Absent:            ${absent}`);
    reportLines.push(`  Attendance Rate:   ${percentage}%`);
    reportLines.push('');
    
    const separator = '  +' + '-'.repeat(14) + '+' + '-'.repeat(22) + '+' + '-'.repeat(10) + '+' + '-'.repeat(10) + '+';
    const headerRow = '  | Student ID' + ' '.repeat(4) + '| Name' + ' '.repeat(18) + '| Status' + ' '.repeat(4) + '| Time' + ' '.repeat(6) + '|';
    
    reportLines.push(separator);
    reportLines.push(headerRow);
    reportLines.push(separator);
    
    reports.forEach(r => {
      const id = (r.studentId || '').padEnd(14).substring(0, 14);
      const name = (r.name || '').padEnd(22).substring(0, 22);
      const status = (r.status || '').padEnd(10).substring(0, 10);
      const time = (r.time || '').padEnd(10).substring(0, 10);
      reportLines.push(`  | ${id}| ${name}| ${status}| ${time}|`);
    });
    
    reportLines.push(separator);
    reportLines.push('');
    reportLines.push('  -- End of Report --');
    
    const textContent = reportLines.join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `attendance_report_${filters.date}.txt`;
    link.click();
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
      <h2 className="animate-fade-in-up" style={{ marginBottom: '1rem', color: 'var(--accent)' }}>Attendance Reports</h2>
      
      <form className="no-print card card-accent-hover" onSubmit={handleSearch} style={{ padding: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Course Code <span style={{fontWeight:400, color:'var(--muted)'}}>(optional)</span></label>
          <input type="text" value={filters.course} placeholder="e.g. CSC101" onChange={e => setFilters({...filters, course: e.target.value})} className="input" style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Date</label>
          <input type="date" value={filters.date} onChange={e => setFilters({...filters, date: e.target.value})} className="input" style={{ width: '100%' }} />
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
