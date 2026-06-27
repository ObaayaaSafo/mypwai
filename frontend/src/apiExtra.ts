import { initDB, persistDBBackup } from './db';
import { fetchStudents } from './api';
import { syncToMySQL } from './offlineSync';

/**
 * Persist IndexedDB backup and then trigger an immediate sync to MySQL.
 * This is called after every local save so that data is promptly pushed
 * to the backend whenever it becomes available.
 */
const persistAndSync = async () => {
  await persistDBBackup();
  // Fire-and-forget sync — don't block the caller on sync completion
  syncToMySQL().catch(() => {
    // Sync failure is non-critical; data is already persisted locally.
  });
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const explicitBase =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI_API_BASE
    ? trimTrailingSlash(import.meta.env.VITE_AI_API_BASE)
    : '';

const candidateBases = explicitBase
  ? [explicitBase]
  : [
      '/api/ai',
      'http://127.0.0.1:4007/api/ai',
      'http://127.0.0.1:4000/api/ai',
      'http://localhost:4007/api/ai',
      'http://localhost:4000/api/ai',
    ];

const adminCandidateBases = [
  '/api/admin',
  'http://127.0.0.1:4007/api/admin',
  'http://127.0.0.1:4000/api/admin',
  'http://localhost:4007/api/admin',
  'http://localhost:4000/api/admin',
];

const authCandidateBases = [
  '/api/auth',
  'http://127.0.0.1:4007/api/auth',
  'http://127.0.0.1:4000/api/auth',
  'http://localhost:4007/api/auth',
  'http://localhost:4000/api/auth',
];

const attendanceCandidateBases = [
  '/api/attendance',
  'http://127.0.0.1:4007/api/attendance',
  'http://127.0.0.1:4000/api/attendance',
  'http://localhost:4007/api/attendance',
  'http://localhost:4000/api/attendance',
];

const requestAI = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  const token = localStorage.getItem('authToken');

  for (const base of candidateBases) {
    const url = `${trimTrailingSlash(base)}${path}`;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> || {}),
      };
      if (token && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(url, { ...init, headers });
      if (!response.ok) {
        let detail = `AI request failed with status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) {
            detail = body.message;
          } else if (body?.error) {
            detail = body.error;
          }
        } catch {
          try {
            const text = await response.text();
            if (text) detail = text;
          } catch {
            // Keep generic message when response body cannot be read.
          }
        }
        throw new Error(detail);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }

  throw lastError || new Error('Unable to reach backend AI API');
};

const requestAuth = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  const token = localStorage.getItem('authToken');

  for (const base of authCandidateBases) {
    const url = `${trimTrailingSlash(base)}${path}`;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> || {}),
      };
      if (token && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(url, { ...init, headers });
      if (!response.ok) {
        let detail = `Auth request failed with status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) {
            detail = body.message;
          } else if (body?.error) {
            detail = body.error;
          }
        } catch {
          try {
            const text = await response.text();
            if (text) detail = text;
          } catch {
            // Keep generic message when response body cannot be read.
          }
        }
        throw new Error(detail);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }

  throw lastError || new Error('Unable to reach backend auth API');
};

const requestAdmin = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  for (const base of adminCandidateBases) {
    const url = `${trimTrailingSlash(base)}${path}`;
    try {
      const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> || {}) } });
      if (!response.ok) {
        let detail = `Admin request failed with status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) detail = body.message;
        } catch { /* keep generic */ }
        throw new Error(detail);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }
  throw lastError || new Error('Unable to reach backend admin API');
};

const requestAttendance = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;

  for (const base of attendanceCandidateBases) {
    const url = `${trimTrailingSlash(base)}${path}`;
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        let detail = `Attendance request failed with status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) detail = body.message;
        } catch {
          // Keep generic detail when body isn't JSON.
        }
        throw new Error(detail);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }

  throw lastError || new Error('Unable to reach backend attendance API');
};

export const fetchMalpracticeEvents = async (courseCode?: string, date?: string, sessionId?: string | null) => {
  try {
    const params = new URLSearchParams();
    if (courseCode) params.set('courseCode', courseCode);
    if (date) params.set('date', date);
    if (sessionId) params.set('sessionId', sessionId);
    const response = await requestAttendance(`/malpractice?${params.toString()}`);
    return await response.json();
  } catch {
    // Fallback: scan local IndexedDB for malpractice entries
    const db = await initDB();
    const allEvents = await db.getAll('scanEvents');
    return allEvents
      .filter((e: any) => {
        const reason = String(e.reason || '');
        if (!reason.startsWith('malpractice:')) return false;
        if (courseCode && e.courseCode !== courseCode) return false;
        if (date && e.date !== date) return false;
        if (sessionId && e.sessionId && String(e.sessionId) !== String(sessionId)) return false;
        return true;
      })
      .map((e: any) => {
        const reason = String(e.reason || '');
        const parts: Record<string, string> = {};
        reason.split('|').forEach((segment: string) => {
          const [key, ...rest] = segment.split(':');
          if (key && rest.length > 0) parts[key.trim()] = rest.join(':').trim();
        });
        return {
          id: e.id,
          studentId: e.studentId,
          studentName: 'Unknown',
          courseCode: e.courseCode,
          date: e.date,
          time: e.time,
          eventType: parts.malpractice || 'unknown',
          severity: parts.severity || 'low',
          score: parseFloat(parts.score || '0'),
          detail: parts[''] || '',
        };
      });
  }
};

export const fetchMalpracticeSummary = async (courseCode?: string, date?: string, sessionId?: string | null) => {
  try {
    const params = new URLSearchParams();
    if (courseCode) params.set('courseCode', courseCode);
    if (date) params.set('date', date);
    if (sessionId) params.set('sessionId', sessionId);
    const response = await requestAttendance(`/malpractice-summary?${params.toString()}`);
    return await response.json();
  } catch {
    return { totalEvents: 0, byType: {}, bySeverity: {}, topTypes: [] };
  }
};

type AISnapshot = {
  students: any[];
  attendance: any[];
  sessions: any[];
  scanEvents: any[];
};

const todayIso = () => new Date().toISOString().split('T')[0];

const nowTime = () => new Date().toLocaleTimeString();

export const buildAISnapshot = async (): Promise<AISnapshot> => {
  const db = await initDB();
  const [students, attendance, sessions, scanEvents] = await Promise.all([
    db.getAll('students'),
    db.getAll('attendance'),
    db.getAll('sessions'),
    db.getAll('scanEvents'),
  ]);

  return { students, attendance, sessions, scanEvents };
};

const postAI = async (path: string, payload: Record<string, unknown>) => {
  const response = await requestAI(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return response.json();
};

const recordScanEvent = async (event: {
  studentId?: string;
  courseCode?: string;
  sessionId?: string;
  result: 'success' | 'failed' | 'duplicate' | 'enrollment';
  reason?: string;
}) => {
  const db = await initDB();
  await db.add('scanEvents', {
    ...event,
    date: todayIso(),
    time: nowTime(),
  });
  await persistAndSync();
};

export const login = async (username: string, password: string) => {
  const normalizedInput = username.trim().toLowerCase();

  try {
    const response = await requestAuth('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normalizedInput, password }),
    });
    const result = await response.json();

    const db = await initDB();
    if (result?.user?.username) {
      await db.put('users', {
        username: result.user.username,
        email: result.user.email || result.user.username,
        fullName: result.user.fullName || result.user.username,
        password,
      });
      await persistAndSync();
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const backendUnavailable = /Unable to reach backend auth API|Network request failed|Failed to fetch/i.test(message);
    if (!backendUnavailable) {
      throw error;
    }

    const db = await initDB();
    const users = await db.getAll('users');
    const user = users.find((entry) =>
      entry.username.toLowerCase() === normalizedInput || entry.email.toLowerCase() === normalizedInput
    );
    if (user && user.password === password) {
      return { success: true, token: 'auth-token-' + Date.now(), user };
    }
    throw new Error('Invalid username or password');
  }
};

export const validateAuthSession = async () => {
  try {
    const response = await requestAuth('/me', { method: 'GET' });
    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const backendUnavailable = /Unable to reach backend auth API|Network request failed|Failed to fetch/i.test(message);

    if (backendUnavailable) {
      // Backend is unreachable — trust the locally stored session
      const username = localStorage.getItem('username');
      const email = localStorage.getItem('email');
      const role = localStorage.getItem('userRole');
      if (username) {
        return {
          success: true,
          user: {
            username,
            email: email || username,
            fullName: username,
            role: role || 'invigilator',
          },
        };
      }
    }

    // Re-throw explicit auth failures (401, 403, invalid token, etc.)
    throw error;
  }
};



export const fetchDashboardStats = async () => {
  try {
    const [studentsRes, sessionsRes, attendanceRes] = await Promise.all([
      requestAttendance('/students'),
      requestAttendance('/sessions'),
      requestAttendance('/attendance'),
    ]);
    const students = await studentsRes.json();
    const sessions = await sessionsRes.json();
    const attendance = await attendanceRes.json();
    const studentCount = Array.isArray(students) ? students.length : 0;
    const sessionCount = Array.isArray(sessions) ? sessions.length : 0;
    // Backend returns raw MySQL field names: attendance_date, student_id
    const today = todayIso();
    const presentToday = new Set(
      (Array.isArray(attendance) ? attendance : [])
        .filter((a: any) => (a.attendance_date || a.date) === today && a.status === 'Present')
        .map((a: any) => a.student_id || a.studentId)
    ).size;
    const attendanceRate = studentCount > 0 ? Math.round((presentToday / studentCount) * 100) : 0;
    return { sessions: sessionCount, students: studentCount, attendance: attendanceRate };
  } catch {
    const db = await initDB();
    const students = await db.count('students');
    const sessions = await db.count('sessions');
    const attendance = await db.getAll('attendance');
    const today = todayIso();
    const presentToday = new Set(
      attendance
        .filter((a: any) => (a.date || a.attendance_date) === today && a.status === 'Present')
        .map((a: any) => a.studentId || a.student_id)
    ).size;
    const attendanceRate = students > 0 ? Math.round((presentToday / students) * 100) : 0;
    return { sessions, students, attendance: attendanceRate };
  }
};

export const fetchMonitoring = async () => {
  let sessions: any[] = [];
  let scanEvents: any[] = [];

  try {
    const [sessionsRes, scanEventsRes] = await Promise.all([
      requestAttendance('/sessions'),
      requestAttendance('/scan-events')
    ]);
    sessions = await sessionsRes.json();
    scanEvents = await scanEventsRes.json();
  } catch {
    const db = await initDB();
    [sessions, scanEvents] = await Promise.all([
      db.getAll('sessions'),
      db.getAll('scanEvents')
    ]);
  }

  const activeSessions = sessions.length;
  const latestEvents = scanEvents
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, 5)
    .map(event => ({
      event: `${event.result === 'failed' ? 'Failed scan' : event.result === 'duplicate' ? 'Duplicate scan' : event.result === 'enrollment' ? 'Enrollment' : 'Attendance'}${event.studentId ? ` for ${event.studentId}` : ''}`,
      time: event.time,
    }));
  
  return {
    activeSessions,
    devicesOnline: 3,
    recentLogs: latestEvents.length > 0 ? latestEvents : [
      { event: 'System started', time: '08:00 AM' },
      { event: 'Device A connected', time: '08:05 AM' },
      { event: 'Exam session started', time: '09:00 AM' }
    ]
  };
};

export const verifyAttendance = async (studentId?: string, fingerprintData?: string, method?: 'fingerprint' | 'face', force?: boolean) => {
  if (!studentId && !fingerprintData) {
    throw new Error('studentId or fingerprint data is required');
  }

  const resolvedMethod: 'fingerprint' | 'face' = method || 'fingerprint';
  // Use the active session's course code so attendance goes to the right course
  const activeCourseCode = localStorage.getItem('activeSessionCourseCode') || undefined;

  // Use the real fingerprint backend when biometric data is available
  if (resolvedMethod === 'fingerprint' && fingerprintData) {
    try {
      const response = await requestFingerprint('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateBase64: fingerprintData, courseCode: activeCourseCode, force: force || false }),
      });
      const result = await response.json();

      // The fingerprint verify endpoint now records attendance automatically.
      // Return a properly formatted message based on the result.
      if (!result.matched) {
        throw new Error(result.message || 'Fingerprint not recognized');
      }

      const student = result.student;
      if (result.attendance === 'duplicate') {
        return { message: `${student.name} (${student.index}) — Already marked present for ${result.courseCode}`, courseCode: result.courseCode, duplicate: true };
      }
      if (result.attendance === 'error') {
        throw new Error(`Verified ${student.name}, but attendance recording failed: ${result.error}`);
      }

      // Attendance successfully recorded
      return { message: `Verified: ${student.name} (${student.index}) — Attendance marked for ${result.courseCode} at ${result.time}`, courseCode: result.courseCode, recorded: true };
    } catch (error) {
      // Real biometric mismatch — propagate to UI
      if (error instanceof Error && /not recognized|attendance recording failed/i.test(error.message)) {
        throw error;
      }
      // Fall through to offline fallback for network errors only
    }
  }

  try {
    const response = await requestAttendance('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, method: resolvedMethod }),
    });
    return response.json();
  } catch (error) {
    const db = await initDB();
    const students = await db.getAll('students');
    const student = studentId ? students.find((entry) => entry.index === studentId) : null;
    if (!student) {
      await recordScanEvent({ studentId, result: 'failed', reason: 'student_not_found' });
      throw new Error('Student not found');
    }

    // Offline enrollment check
    if (resolvedMethod === 'fingerprint' && !student.fingerprintEnrolled) {
      await recordScanEvent({ studentId, result: 'failed', reason: 'fingerprint_not_enrolled' });
      throw new Error(`Fingerprint not enrolled for ${student.name}`);
    }

    if (resolvedMethod === 'face' && !student.faceEnrolled) {
      await recordScanEvent({ studentId, result: 'failed', reason: 'face_not_enrolled' });
      throw new Error(`Face not enrolled for ${student.name}`);
    }

    const sessions = await db.getAll('sessions');
    const todaySessions = sessions.filter(session => session.date === todayIso());
    const activeSession = todaySessions[0];
    const courseCode = activeSession?.courseCode || 'DEMO101';
    const resolvedStudentId = student.index;

    const existingAttendance = (await db.getAll('attendance')).find(record =>
      record.studentId === resolvedStudentId &&
      record.courseCode === courseCode &&
      record.date === todayIso() &&
      record.status === 'Present'
    );

    if (existingAttendance) {
      await recordScanEvent({ studentId: resolvedStudentId, courseCode, result: 'duplicate', reason: 'duplicate_check_in' });
      return { message: `Duplicate scan detected for ${student.name}` };
    }

    await db.add('attendance', {
      studentId: resolvedStudentId,
      courseCode,
      date: todayIso(),
      time: nowTime(),
      status: 'Present'
    });
    await recordScanEvent({ studentId: resolvedStudentId, courseCode, result: 'success' });

    return { message: `Verified: ${student.name}`, courseCode };
  }
};

const fingerprintCandidateBases = [
  '/api/fingerprint',
  'http://127.0.0.1:4007/api/fingerprint',
  'http://127.0.0.1:4000/api/fingerprint',
  'http://localhost:4007/api/fingerprint',
  'http://localhost:4000/api/fingerprint',
];

const requestFingerprint = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  const token = localStorage.getItem('authToken');

  for (const base of fingerprintCandidateBases) {
    const url = `${trimTrailingSlash(base)}${path}`;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> || {}),
      };
      if (token && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(url, { ...init, headers });
      if (!response.ok) {
        let detail = `Fingerprint request failed with status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) detail = body.message;
          else if (body?.error) detail = body.error;
        } catch {
          try { const text = await response.text(); if (text) detail = text; } catch {}
        }
        throw new Error(detail);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }
  throw lastError || new Error('Unable to reach backend fingerprint API');
};

export const enrollFingerprint = async (studentId: string, fingerprintData?: string) => {
  try {
    // If we have a real capture, call the real fingerprint backend
    if (fingerprintData) {
      // Send the already-captured template so the backend doesn't scan again.
      const res = await requestFingerprint('/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, templateBase64: fingerprintData }),
      });
      const result = await res.json();

      // Also update IndexedDB so offline fallback shows correct status
      try {
        const db = await initDB();
        const existing = await db.get('students', studentId);
        if (existing) {
          await db.put('students', { ...existing, fingerprintEnrolled: true });
          await persistDBBackup();
        }
      } catch { /* non-critical */ }

      return result;
    }

    // Fallback: mark enrolled locally via attendance API
    const studentsRes = await requestAttendance('/students');
    const students = await studentsRes.json();
    const student = (Array.isArray(students) ? students : []).find((entry: any) => entry.index === studentId);
    if (!student) {
      throw new Error('Student not found');
    }

    await requestAttendance('/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...student, fingerprintEnrolled: true }),
    });
    await requestAttendance('/scan-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, date: todayIso(), time: nowTime(), result: 'enrollment' }),
    });
    return { message: 'Fingerprint enrolled successfully' };
  } catch {
    const db = await initDB();
    const student = await db.get('students', studentId);
    if (!student) {
      await recordScanEvent({ studentId, result: 'failed', reason: 'enrollment_student_not_found' });
      throw new Error('Student not found');
    }

    student.fingerprintEnrolled = true;
    await db.put('students', student);
    await recordScanEvent({ studentId, result: 'enrollment' });
    return { message: 'Fingerprint enrolled successfully' };
  }
};

export const fetchReports = async (course: string, date: string, sessionId?: string | null) => {
  try {
    // Use the proper backend report endpoint with JOINed student data
    const params = new URLSearchParams();
    if (course) params.set('courseCode', course);
    if (date) params.set('date', date);
    if (sessionId) params.set('sessionId', sessionId);
    const response = await requestAttendance(`/reports?${params.toString()}`);
    const records = await response.json();
    return Array.isArray(records) ? records : [];
  } catch {
    // Offline fallback: load from IndexedDB and filter locally
    const db = await initDB();
    const [allAttendance, allStudents, allSessions] = await Promise.all([
      db.getAll('attendance'),
      db.getAll('students'),
      db.getAll('sessions'),
    ]);

    // If a session is active, resolve its course+date for precise filtering
    let effectiveCourse = course;
    let effectiveDate = date;
    if (sessionId && !course && !date) {
      const activeSession = allSessions.find((s: any) => String(s.id) === String(sessionId));
      if (activeSession) {
        effectiveCourse = activeSession.courseCode || effectiveCourse;
        effectiveDate = activeSession.date || effectiveDate;
      }
    }

    // Filter locally with proper AND logic
    const records = allAttendance.filter((a: any) => {
      const dateMatch = !effectiveDate || a.date === effectiveDate;
      const courseMatch = !effectiveCourse || a.courseCode === effectiveCourse;
      return dateMatch && courseMatch;
    });

    // Build records with student names from IndexedDB
    const result = records.map((r: any) => {
      const student = allStudents.find((s: any) => s.index === r.studentId);
      return {
        studentId: r.studentId,
        name: student ? student.name : 'Unknown',
        status: r.status,
        time: r.time,
      };
    });

    // Also add absent students (those who never showed up)
    const presentIds = new Set(result.map((r: any) => r.studentId));
    const absentRecords = allStudents
      .filter((s: any) => !presentIds.has(s.index))
      .map((s: any) => ({
        studentId: s.index,
        name: s.name,
        status: 'Absent',
        time: '-',
      }));

    return [...result, ...absentRecords].sort((a: any, b: any) => a.studentId.localeCompare(b.studentId));
  }
};

export const fetchSessions = async () => {
  try {
    const response = await requestAttendance('/sessions');
    return response.json();
  } catch {
    const db = await initDB();
    return db.getAll('sessions');
  }
};

export const createSession = async (session: any) => {
  try {
    // Map camelCase (frontend) → snake_case (backend MySQL)
    const payload = {
      id: session.id,
      course: session.course,
      course_code: session.courseCode,
      session_date: session.date,
      session_time: session.time,
      hall: session.hall,
    };
    const response = await requestAttendance('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.json();
  } catch {
    const db = await initDB();
    const result = await db.put('sessions', session);
    await persistAndSync();
    return result;
  }
};

export const deleteSession = async (id: number) => {
  try {
    const response = await requestAttendance(`/sessions/${id}`, {
      method: 'DELETE',
    });
    return response.json();
  } catch {
    const db = await initDB();
    const result = await db.delete('sessions', id);
    await persistAndSync();
    return result;
  }
};

export const fetchAIReport = async () => {
  const snapshot = await buildAISnapshot();
  return postAI('/report', { snapshot });
};

export const fetchAIAnomalies = async () => {
  const snapshot = await buildAISnapshot();
  return postAI('/anomalies', { snapshot });
};

export const askAIAssistant = async (question: string) => {
  const snapshot = await buildAISnapshot();
  return postAI('/chat', { question, snapshot });
};

export const analyzeMalpracticeFrame = async (payload: {
  imageBase64: string;
  cameraId: string;
  hallId: string;
  studentId: string;
}) => {
  return postAI('/malpractice/frame', payload);
};

export const getRekognitionCollectionStatus = async () => {
  const response = await requestAI('/malpractice/collection/status');
  return response.json();
};

export const initializeRekognitionCollection = async () => {
  return postAI('/malpractice/collection/init', {});
};

export const enrollFaceToRekognitionCollection = async (payload: {
  imageBase64: string;
  studentId: string;
}) => {
  return postAI('/malpractice/collection/enroll', payload);
};

export const checkDuplicateFaceEnrollment = async (imageBase64: string, studentId: string) => {
  try {
    const response = await requestAI('/malpractice/collection/check-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, studentId }),
    });
    return response.json();
  } catch {
    // If the check fails (offline or no AWS), return no duplicate to allow enrollment
    return { checked: false, isDuplicate: false, matchedStudentId: null };
  }
};

export const listRekognitionFaces = async () => {
  const response = await requestAI('/malpractice/collection/faces');
  return response.json();
};

export const deleteRekognitionFace = async (faceId: string) => {
  const response = await requestAI(`/malpractice/collection/faces/${encodeURIComponent(faceId)}`, {
    method: 'DELETE',
  });
  return response.json();
};

export const fetchStudentIdOptions = async () => {
  const db = await initDB();
  const students = await db.getAll('students');
  return students
    .map((student) => ({ id: student.index, name: student.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
};

export const fetchFaceEnrolledStudents = async () => {
  // Use fetchStudents to ensure backend fields are normalized (faceEnrolled)
  try {
    const students = await fetchStudents();
    return Array.isArray(students) ? students.filter((s: any) => Boolean(s.faceEnrolled)) : [];
  } catch (err) {
    const db = await initDB();
    const students = await db.getAll('students');
    return students.filter((student) => Boolean((student as any).faceEnrolled));
  }
};

/**
 * fetchAllFromMySQL - Get all data from MySQL via the export endpoint
 * Falls back to IndexedDB if backend is unavailable
 */
export const fetchAllFromMySQL = async (): Promise<{
  students: any[];
  sessions: any[];
  attendance: any[];
  scanEvents: any[];
}> => {
  try {
    const response = await requestAttendance('/export');
    const data = await response.json();
    return {
      students: Array.isArray(data.students) ? data.students : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      attendance: Array.isArray(data.attendance) ? data.attendance : [],
      scanEvents: Array.isArray(data.scanEvents) ? data.scanEvents : [],
    };
  } catch {
    // Fallback to IndexedDB
    const db = await initDB();
    const [students, sessions, attendance, scanEvents] = await Promise.all([
      db.getAll('students'),
      db.getAll('sessions'),
      db.getAll('attendance'),
      db.getAll('scanEvents'),
    ]);
    return { students, sessions, attendance, scanEvents };
  }
};

/**
 * pushAllToMySQL - Import data to MySQL via the import endpoint
 * Falls back to IndexedDB if backend is unavailable
 */
export const pushAllToMySQL = async (payload: {
  students?: any[];
  sessions?: any[];
  attendance?: any[];
}): Promise<{ success: boolean; added: any; duplicates: any; errors: string[] }> => {
  try {
    const response = await requestAttendance('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    return result;
  } catch {
    // Fallback: save to IndexedDB with duplicate detection
    const db = await initDB();
    const students = payload.students || [];
    const sessions = payload.sessions || [];
    const attendance = payload.attendance || [];
    
    let studentAdded = 0, studentDup = 0;
    let sessionAdded = 0, sessionDup = 0;
    let attendanceAdded = 0;

    for (const s of students) {
      const key = s.index || s.index_no;
      if (key) {
        const exists = await db.get('students', key);
        if (exists) { studentDup++; continue; }
        await db.put('students', s);
        studentAdded++;
      }
    }
    for (const s of sessions) {
      const key = s.id;
      if (key) {
        const exists = await db.get('sessions', key);
        if (exists) { sessionDup++; continue; }
        await db.put('sessions', s);
        sessionAdded++;
      }
    }
    for (const a of attendance) {
      await db.add('attendance', a);
      attendanceAdded++;
    }
    await persistAndSync();

    return {
      success: true,
      added: { students: studentAdded, sessions: sessionAdded, attendance: attendanceAdded },
      duplicates: { students: studentDup, sessions: sessionDup, attendance: 0 },
      errors: [],
    };
  }
};

// ── Student Course Enrollment ──

export const fetchCourseEnrollments = async (courseCode?: string) => {
  try {
    const params = courseCode ? `?courseCode=${encodeURIComponent(courseCode)}` : '';
    const response = await requestAttendance(`/student-courses${params}`);
    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch enrollments';
    throw new Error(message);
  }
};

export const fetchEnrolledCourses = async (): Promise<string[]> => {
  try {
    const response = await requestAttendance('/student-courses/courses');
    const data = await response.json();
    return Array.isArray(data.courses) ? data.courses : [];
  } catch {
    return [];
  }
};

export const assignStudentsToCourse = async (courseCode: string, studentIds: string[]) => {
  try {
    const response = await requestAttendance('/student-courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseCode, studentIds }),
    });
    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
      const detail = result.errors.slice(0, 5).join('; ');
      if (result.added === 0) {
        throw new Error(`None added. ${detail}`);
      }
      // Partial success — return with warnings
      result._warnings = detail;
    }
    if (result.added === 0 && result.skipped > 0 && !result.errors) {
      throw new Error('None of the selected students could be added. Check student IDs.');
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign students';
    throw new Error(message);
  }
};

export const removeStudentsFromCourse = async (courseCode: string, studentIds: string[]) => {
  try {
    const response = await requestAttendance('/student-courses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseCode, studentIds }),
    });
    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove students';
    throw new Error(message);
  }
};

// ── Session Locks ──

export const lockSession = async (sessionId: number, username: string, role: string) => {
  const response = await requestAttendance('/session-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, username, role }),
  });
  return response.json();
};

export const unlockSession = async (sessionId: number, username: string, role: string) => {
  const response = await requestAttendance(`/session-lock/${sessionId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, role }),
  });
  return response.json();
};

export const checkSessionLock = async (sessionId: number) => {
  const response = await requestAttendance(`/session-lock/${sessionId}`);
  return response.json();
};

// ── Admin: Invigilator Management ──

export const fetchInvigilators = async () => {
  const response = await requestAdmin('/invigilators');
  return response.json();
};

export const createInvigilator = async (fullName: string, email: string) => {
  const response = await requestAdmin('/invigilators', {
    method: 'POST',
    body: JSON.stringify({ fullName, email }),
  });
  return response.json();
};

export const bulkCreateInvigilators = async (entries: { fullName: string; email: string }[]) => {
  const response = await requestAdmin('/invigilators/bulk', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
  return response.json();
};

export const deleteInvigilator = async (id: number) => {
  const response = await requestAdmin(`/invigilators/${id}`, { method: 'DELETE' });
  return response.json();
};

export const resetInvigilatorPassword = async (id: number) => {
  const response = await requestAdmin(`/invigilators/${id}/reset-password`, { method: 'POST' });
  return response.json();
};

export const bulkResetInvigilatorPasswords = async (ids: number[]) => {
  const response = await requestAdmin('/invigilators/bulk-reset-passwords', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  return response.json();
};

export const storeMalpracticeEvent = async (payload: {
  studentId?: string;
  eventType: string;
  severity: 'low' | 'medium' | 'high';
  suspicionScore: number;
  detail: string;
  sessionId?: string;
}) => {
  try {
    await requestAttendance('/scan-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: payload.studentId,
        date: todayIso(),
        time: nowTime(),
        sessionId: payload.sessionId,
        result: 'failed',
        reason: `malpractice:${payload.eventType}|severity:${payload.severity}|score:${payload.suspicionScore}|${payload.detail}`,
      }),
    });
  } catch {
    const db = await initDB();
    await db.add('scanEvents', {
      studentId: payload.studentId,
      date: todayIso(),
      time: nowTime(),
      sessionId: payload.sessionId,
      result: 'failed',
      reason: `malpractice:${payload.eventType}|severity:${payload.severity}|score:${payload.suspicionScore}|${payload.detail}`,
    });
    await persistAndSync();
  }
};
