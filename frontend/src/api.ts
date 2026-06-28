import { initDB, persistDBBackup } from './db';

const hasPhoto = (photo?: string | null) => typeof photo === 'string' && photo.trim().length > 0;

const apiBases = [
  '/api',
  `${window.location.protocol}//${window.location.hostname}:4007/api`,
  'http://127.0.0.1:4007/api',
  'http://localhost:4007/api',
  `${window.location.protocol}//${window.location.hostname}:4000/api`,
  'http://127.0.0.1:4000/api',
  'http://localhost:4000/api',
];

const attendanceBases = apiBases.map(b => `${b}/attendance`);
const studentBases = apiBases.map(b => `${b}/students`);

const tryFetch = async (bases: string[], path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API failed with status ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }
  throw lastError || new Error('Unable to reach backend API');
};

const requestAttendance = async (path: string, init?: RequestInit) => tryFetch(attendanceBases, path, init);
const requestStudents = async (path: string, init?: RequestInit) => tryFetch(studentBases, path, init);

export const fetchStudents = async () => {
  // Try dedicated /api/students endpoint first, fall back to /api/attendance/students for backward compat
  try {
    const response = await requestStudents('');
    const students = await response.json();
    if (!Array.isArray(students)) return [];
    return students.map((s: any) => ({
      index: s.index_no || s.index || '',
      name: s.name,
      programme: s.programme || '',
      level: s.level || '',
      fingerprintEnrolled: s.fingerprintEnrolled ?? s.fingerprint_enrolled ?? false,
      faceEnrolled: s.faceEnrolled ?? s.face_enrolled ?? hasPhoto(s.photo ?? s.photo_url),
      photo: s.photo ?? s.photo_url ?? null,
    }));
  } catch {
    try {
      const response = await requestAttendance('/students');
      const students = await response.json();
      if (!Array.isArray(students)) return [];
      return students.map((s: any) => ({
        index: s.index_no || s.index || '',
        name: s.name,
        programme: s.programme || '',
        level: s.level || '',
        fingerprintEnrolled: s.fingerprintEnrolled ?? s.fingerprint_enrolled ?? false,
        faceEnrolled: s.faceEnrolled ?? s.face_enrolled ?? hasPhoto(s.photo ?? s.photo_url),
        photo: s.photo ?? s.photo_url ?? null,
      }));
    } catch {
      // Offline fallback: load from IndexedDB
      const db = await initDB();
      const students = await db.getAll('students');
      return students.map((student: any) => ({
        ...student,
        faceEnrolled: student.faceEnrolled ?? student.face_enrolled ?? hasPhoto(student.photo),
      }));
    }
  }
};

export const addStudent = async (student: any) => {
  const payload: any = {
    index: student.index,
    index_no: student.index,
    name: student.name,
    programme: student.programme,
    level: student.level,
    photo_url: student.photo ?? null,
    photo: student.photo ?? null,
  };
  // Include biometric flags only when explicitly set (so backend doesn't reset them)
  if ('faceEnrolled' in student) payload.faceEnrolled = student.faceEnrolled;
  if ('fingerprintEnrolled' in student) payload.fingerprintEnrolled = student.fingerprintEnrolled;

  // Try dedicated /api/students first, fall back to /api/attendance/students
  try {
    const response = await requestStudents('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resJson = await response.json();
    return resJson;
  } catch (firstError) {
    try {
      const response = await requestAttendance('/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resJson = await response.json();
      return resJson;
    } catch {
      // Both endpoints failed — throw so the caller can show the error
      // Also save to IndexedDB as offline fallback
      try {
        const db = await initDB();
        const existing = await db.get('students', student.index);
        const fingerprintEnrolled = student.fingerprintEnrolled ?? (existing ? existing.fingerprintEnrolled : false);
        const faceEnrolled = Boolean(student.faceEnrolled ?? (existing ? existing.faceEnrolled : false)) || hasPhoto(student.photo ?? existing?.photo);
        await db.put('students', { ...student, fingerprintEnrolled, faceEnrolled });
        await persistDBBackup();
      } catch { /* IndexedDB fallback also failed */ }
      throw firstError instanceof Error ? firstError : new Error('Failed to save student — backend unreachable');
    }
  }
};

export const deleteStudent = async (index: string) => {
  const doLocalCleanup = async () => {
    try {
      const db = await initDB();
      await db.delete('students', index);
      await persistDBBackup();
    } catch { /* local cleanup failed — not critical */ }
  };

  // Try dedicated /api/students first, fall back to /api/attendance/students
  try {
    const response = await requestStudents(`/${encodeURIComponent(index)}`, { method: 'DELETE' });
    try {
      const result = await response.json();
      await doLocalCleanup();
      return result;
    } catch {
      await doLocalCleanup();
      return { success: true };
    }
  } catch {
    try {
      const response = await requestAttendance(`/students/${encodeURIComponent(index)}`, { method: 'DELETE' });
      try {
        const result = await response.json();
        await doLocalCleanup();
        return result;
      } catch {
        await doLocalCleanup();
        return { success: true };
      }
    } catch {
      await doLocalCleanup();
      return { success: true };
    }
  }
};