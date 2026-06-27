import React, { useEffect, useState } from 'react';
import { enrollFingerprint } from '../apiExtra';
import { fetchStudents } from '../api';
import { FingerprintCapture, ScannerService, ScannerDeviceInfo } from '../scannerService';

const enrollmentSteps = ['Connect scanner', 'Capture primary print', 'Assess quality', 'Store enrollment template'];

const cardStyle: React.CSSProperties = {
  background: 'var(--card)',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.35s ease',
};

const FingerprintEnrollmentPage: React.FC = () => {
  const [studentId, setStudentId] = useState('');
  const [status, setStatus] = useState('');
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
      setStatus('Connecting fingerprint scanner...');
      await ScannerService.connect();
      setDeviceConnected(true);
      setDeviceInfo(await ScannerService.getDeviceInfo());
      setStatus('Fingerprint scanner is ready for enrollment.');
      return true;
    } catch (error) {
      setDeviceConnected(false);
      setDeviceInfo(null);
      setStatus(error instanceof Error ? error.message : 'Fingerprint support check failed');
      return false;
    }
  };

  const handleEnroll = async () => {
    if (!deviceConnected) {
      const connected = await connectScanner();
      if (!connected) {
        return;
      }
    }

    if (!studentId.trim()) {
      setStatus('Enter a student ID before starting enrollment.');
      return;
    }

    // Verify student exists before attempting fingerprint capture
    try {
      const allStudents = await fetchStudents();
      const found = allStudents.some((s: any) => s.index === studentId.trim());
      if (!found) {
        setStatus(`Student ID "${studentId.trim()}" is not registered. Please add the student first in Student Management.`);
        playErrorSound();
        return;
      }
    } catch {
      // If fetchStudents fails (backend down), proceed anyway — student may be in IndexedDB
    }

    setLoading(true);
    setStatus('Enrollment capture in progress... Place the finger on the connected scanner when prompted.');
    setCapture(null);
    setScanProgress(8);
    setActiveStep(0);

    const progressTimer = window.setInterval(() => {
      setScanProgress((current) => {
        if (current >= 94) return current;
        return current + 8;
      });
    }, 180);

    const stepTimer = window.setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, enrollmentSteps.length - 1));
    }, 540);

    try {
      const fingerprintData = await ScannerService.capture();
      setCapture(fingerprintData);
      const res = await enrollFingerprint(studentId.trim(), fingerprintData.template);
      setActiveStep(enrollmentSteps.length - 1);
      setScanProgress(100);
      setStatus(`${res.message}. Scanner capture quality ${fingerprintData.quality}%.`);
      playSuccessSound();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Enrollment failed');
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
          <h2 className="animate-fade-in-up" style={{ color: 'var(--accent)', marginBottom: '0.5rem', fontWeight: 700, fontSize: '2.25rem' }}>Fingerprint Enrollment</h2>
          <p className="animate-fade-in-up delay-1" style={{ color: 'var(--muted)', margin: 0, maxWidth: '760px', lineHeight: 1.6 }}>
            Register new biometric templates with the connected fingerprint scanner. See device readiness, capture quality, and enrollment status at a glance.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div className="animate-scale-in delay-2 card-accent-hover" style={{ ...cardStyle, padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Enrollment Bay
                </div>
                <h3 style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '1.15rem', fontWeight: 500 }}>Capture and Quality Review</h3>
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
                <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: deviceConnected ? 'var(--upsa-success)' : 'var(--upsa-danger)' }} />
                {deviceConnected ? 'Scanner ready' : 'Sensor unavailable'}
              </div>
            </div>

            <div style={{
              minHeight: '330px',
              borderRadius: '28px',
              overflow: 'hidden',
              background: 'radial-gradient(circle at center, rgba(16,185,129,0.18), rgba(15,23,42,0.92) 60%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              border: '1px solid rgba(16,185,129,0.24)',
            }}>
              {loading && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${scanProgress}%`,
                  background: 'linear-gradient(180deg, rgba(33,205,143,0.06), rgba(33,205,143,0.28))',
                  transition: 'height 0.18s linear',
                }} />
              )}
              <div style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: '220px',
                  height: '250px',
                  borderRadius: '36px',
                  border: `2px solid ${loading ? '#6EE7B7' : 'var(--text-secondary)'}`,
                  boxShadow: loading ? '0 0 0 12px rgba(110,231,183,0.08), 0 0 45px rgba(16,185,129,0.18)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--border)',
                  transition: 'all 0.25s ease',
                  margin: '0 auto',
                }}>
                  <svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke={loading ? '#6EE7B7' : 'var(--muted)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 6" />
                    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                    <path d="M8.63 7.17A2 2 0 0 1 9.71 5.5" />
                    <path d="M14 11.99V19a4 4 0 0 1-4 4" />
                    <path d="M15.5 19.5C15.5 19 15.5 17 15.5 16a4 4 0 0 0-4-4" />
                    <path d="M21.54 15H21a5 5 0 0 0-5 5v2" />
                  </svg>
                </div>
                <div style={{ marginTop: '1rem', color: '#ECFDF5', fontWeight: 700 }}>
                  {loading ? 'Reading fingerprint ridges for enrollment...' : 'Ready to register a new fingerprint'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontWeight: 700, marginBottom: '0.45rem' }}>
                <span>Enrollment progress</span>
                <span>{scanProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '12px', borderRadius: '999px', background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: `${scanProgress}%`, height: '100%', background: 'linear-gradient(90deg, var(--upsa-success), var(--upsa-success))', transition: 'width 0.2s ease' }} />
              </div>
            </div>
          </div>

          <div className="animate-scale-in delay-3" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="card-accent-hover" style={{ ...cardStyle, padding: '1.35rem' }}>
              <h3 style={{ marginTop: 0, color: 'var(--accent)', fontSize: '1.15rem', fontWeight: 600 }}>Enrollment Controls</h3>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Student ID</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Enter student ID"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={loading}
                  className="input"
                  style={{ flex: 1, borderRadius: '16px' }}
                />
                <button
                  onClick={handleEnroll}
                  disabled={loading}
                  className="btn-lift"
                  style={{
                    padding: '0 1.25rem',
                    border: 'none',
                    borderRadius: '16px',
                    background: loading ? 'var(--input-bg)' : 'var(--accent)',
                    color: loading ? 'var(--muted)' : 'var(--upsa-navy)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                    minWidth: '130px',
                  }}
                >
                  {loading ? 'Enrolling...' : 'Enroll'}
                </button>
              </div>

              <div style={{ marginTop: '1.2rem', display: 'grid', gap: '0.65rem' }}>
                {enrollmentSteps.map((step, index) => {
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
          </div>
        </div>

        {status && (
          <div className="card-accent-hover" style={{
            marginTop: '1.5rem',
            ...cardStyle,
            padding: '1rem 1.25rem',
            borderLeft: status.toLowerCase().includes('failed') || status.toLowerCase().includes('offline') ? '6px solid var(--upsa-danger)' : '6px solid #5EEAD4',
            color: 'var(--text)',
            fontWeight: 700,
          }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

export default FingerprintEnrollmentPage;
