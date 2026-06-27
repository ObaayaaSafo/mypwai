import React, { useEffect, useState } from 'react';
import { verifyAttendance } from '../apiExtra';
import {
  FingerprintCapture,
  ScannerService,
  ScannerDeviceInfo,
} from '../scannerService';

const progressSteps = ['Sensor armed', 'Fingerprint captured', 'Template matched', 'Attendance logged'];

type AttendanceResult = {
  studentName?: string;
  studentIndex?: string;
  courseCode?: string;
  time?: string;
  duplicate?: boolean;
  recorded?: boolean;
};

const glassCard: React.CSSProperties = {
  background: 'var(--card)',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.35s ease',
};

const AttendancePage: React.FC = () => {
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error' | 'warning'>('info');
  const [loading, setLoading] = useState(false);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [deviceInfo, setDeviceInfo] = useState<ScannerDeviceInfo | null>(null);
  const [capture, setCapture] = useState<FingerprintCapture | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    probeDeviceConnection();
  }, []);

  const playSuccessSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 600);
    } catch (error) {
      console.error(error);
    }
  };

  const playErrorSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => ctx.close(), 400);
    } catch (error) {
      console.error(error);
    }
  };

  const probeDeviceConnection = async () => {
    try {
      const connected = await ScannerService.probeConnection();
      setDeviceConnected(connected);
      if (connected) {
        setDeviceInfo(await ScannerService.getDeviceInfo());
      } else {
        setDeviceInfo(null);
      }
    } catch (error) {
      setDeviceConnected(false);
      setDeviceInfo(null);
    }
  };

  const connectScanner = async () => {
    try {
      setMessage('Connecting fingerprint scanner...');
      await ScannerService.connect();
      setDeviceConnected(true);
      setDeviceInfo(await ScannerService.getDeviceInfo());
      setMessage('Fingerprint scanner is ready. Click Verify and place the finger on the scanner.');
      return true;
    } catch (error) {
      setDeviceConnected(false);
      setDeviceInfo(null);
      setMessage(error instanceof Error ? error.message : 'Fingerprint support check failed');
      return false;
    }
  };

  const handleVerify = async () => {
    if (!deviceConnected) {
      const connected = await connectScanner();
      if (!connected) {
        return;
      }
    }

    setLoading(true);
    setMessage('Biometric verification in progress... place the finger on the connected scanner.');
    setCapture(null);
    setScanProgress(10);
    setActiveStep(0);

    const progressTimer = window.setInterval(() => {
      setScanProgress((current) => {
        if (current >= 92) {
          return current;
        }
        return current + 9;
      });
    }, 180);

    const stepTimer = window.setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, progressSteps.length - 1));
    }, 520);

    try {
      const fingerprintData = await ScannerService.capture();
      setCapture(fingerprintData);
      setActiveStep(1);

      const res = await verifyAttendance(undefined, fingerprintData.template);
      setActiveStep(progressSteps.length - 1);
      setScanProgress(100);
      setMessage(res.message);
      setMessageType(res.duplicate ? 'warning' : 'success');
      playSuccessSound();
    } catch (error) {
      console.error('Attendance verification error:', error);
      const errMsg = error instanceof Error ? error.message : 'Verification failed';
      setMessage(errMsg);
      setMessageType('error');
      setScanProgress(0);
      setActiveStep(0);
      playErrorSound();
    } finally {
      window.clearInterval(progressTimer);
      window.clearInterval(stepTimer);
      setLoading(false);
    }
  };

  return (
    <div
      className="page-enter"
      style={{
        minHeight: 'calc(100vh - 68px)',
        width: '100%',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ color: '#BAE6FD', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.82rem' }}>
            Fingerprint Verification
          </div>
          <h1 className="animate-fade-in-up" style={{ color: 'var(--accent)', margin: '0.45rem 0 0.5rem', fontSize: '2rem', fontWeight: 700 }}>Biometric Attendance Gate</h1>
          <p className="animate-fade-in-up delay-1" style={{ color: 'var(--text)', margin: 0, maxWidth: '720px', lineHeight: 1.6 }}>
            Connect the fingerprint scanner, then scan a finger to automatically identify the student and mark attendance. No manual ID entry needed — the system matches the fingerprint against all enrolled templates.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem' }}>
          <div className="animate-scale-in delay-2 card-accent-hover" style={{ ...glassCard, padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#0EA5E9', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Live Sensor Feed
                </div>
                <h3 style={{ margin: '0.35rem 0 0', color: 'var(--text)', fontSize: '1.5rem' }}>Fingerprint Capture Surface</h3>
              </div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 0.9rem',
                borderRadius: '999px',
                background: deviceConnected ? '#134E4A' : '#7F1D1D',
                color: deviceConnected ? '#5EEAD4' : '#FCA5A5',
                fontWeight: 700,
              }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: deviceConnected ? '#5EEAD4' : '#FCA5A5' }} />
                {deviceConnected ? 'Scanner ready' : 'Sensor unavailable'}
              </div>
            </div>

            <div
              style={{
                position: 'relative',
                minHeight: '340px',
                borderRadius: '28px',
                overflow: 'hidden',
                background: 'radial-gradient(circle at center, rgba(14,165,233,0.22), rgba(15,23,42,0.92) 60%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(14,165,233,0.24)',
              }}
            >
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 14px)',
                opacity: 0.6,
              }} />
              {loading && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${scanProgress}%`,
                  background: 'linear-gradient(180deg, rgba(45,212,191,0.05), rgba(45,212,191,0.28))',
                  transition: 'height 0.18s linear',
                }} />
              )}
              <div style={{ position: 'relative', textAlign: 'center' }}>
                <div style={{
                  width: '210px',
                  height: '250px',
                  borderRadius: '36px',
                  border: `2px solid ${loading ? '#67E8F9' : 'var(--text-secondary)'}`,
                  boxShadow: loading ? '0 0 0 12px rgba(103,232,249,0.08), 0 0 45px rgba(34,211,238,0.18)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  background: 'var(--border)',
                  transition: 'all 0.25s ease',
                }}>
                  <svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke={loading ? '#67E8F9' : 'var(--muted)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 6" />
                    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                    <path d="M8.63 7.17A2 2 0 0 1 9.71 5.5" />
                    <path d="M14 11.99V19a4 4 0 0 1-4 4" />
                    <path d="M15.5 19.5C15.5 19 15.5 17 15.5 16a4 4 0 0 0-4-4" />
                    <path d="M21.54 15H21a5 5 0 0 0-5 5v2" />
                  </svg>
                </div>
                <div style={{ marginTop: '1rem', color: '#E0F2FE', fontWeight: 700 }}>
                  {loading ? 'Acquiring ridge pattern...' : 'Ready for fingerprint input'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontWeight: 700, marginBottom: '0.45rem' }}>
                <span>Capture progress</span>
                <span>{scanProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '10px', borderRadius: '999px', background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: `${scanProgress}%`, height: '100%', background: 'linear-gradient(90deg, #0EA5E9, #14B8A6)', transition: 'width 0.2s ease' }} />
              </div>
            </div>
          </div>

          <div className="animate-scale-in delay-3" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="card-accent-hover" style={{ ...glassCard, padding: '1.35rem' }}>
              <div style={{ color: '#0EA5E9', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Operator Console
              </div>
              <div style={{ marginTop: '0.9rem' }}>
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: '0 0 1rem' }}>
                  Simply press the button below and place a finger on the scanner. The system will automatically identify the student and mark attendance.
                </p>
                  <button
                    onClick={handleVerify}
                    disabled={loading}
                    className={`btn btn-lift ${loading ? 'btn-disabled' : 'btn-primary'}`}
                    style={{
                      width: '100%',
                      marginTop: '0.75rem',
                      justifyContent: 'center',
                      fontWeight: 800,
                      borderRadius: '16px',
                      padding: '1rem',
                    }}
                  >
                  {loading ? 'Scanning fingerprint...' : 'Scan Fingerprint & Mark Attendance'}
                  </button>
              </div>

              <div style={{ marginTop: '1.2rem', display: 'grid', gap: '0.65rem' }}>
                {progressSteps.map((step, index) => {
                  const complete = index <= activeStep && (loading || scanProgress === 100);
                  return (
                    <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: complete ? '#5EEAD4' : 'var(--muted)' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '999px',
                        background: complete ? '#134E4A' : 'var(--border)',
                        color: complete ? '#5EEAD4' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        flexShrink: 0,
                      }}>
                        {index + 1}
                      </div>
                      <span style={{ fontWeight: 700 }}>{step}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  onClick={connectScanner}
                  disabled={loading || deviceConnected}
                  className="btn-outline-action"
                >
                  Check fingerprint support
                </button>
                <button
                  onClick={probeDeviceConnection}
                  disabled={loading}
                  className="btn-outline-action"
                >
                  Check status
                </button>
              </div>
            </div>

            <div className="card-accent-hover" style={{ ...glassCard, padding: '1.35rem', marginTop: '1.25rem' }}>
              <div style={{ color: 'var(--muted)', lineHeight: 1.45, fontSize: '0.9rem' }}>
                Place any enrolled finger on the scanner and the system will automatically identify the student, verify their enrollment, and record attendance for the current active session.
              </div>
            </div>
          </div>
        </div>

        {message && (
          <div className="card-accent-hover" style={{
            marginTop: '1.5rem',
            ...glassCard,
            padding: '1rem 1.25rem',
            borderLeft: messageType === 'error' ? '6px solid var(--upsa-danger)' : messageType === 'warning' ? '6px solid #FCD34D' : '6px solid #5EEAD4',
            background: messageType === 'error' ? '#7F1D1D20' : messageType === 'warning' ? '#78350F20' : '#134E4A20',
            color: 'var(--text)',
            fontWeight: 700,
          }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendancePage;
