import { initDB, persistDBBackup } from './db';

const hasPhoto = (photo?: string | null) => typeof photo === 'string' && photo.trim().length > 0;

const attendanceBases = [
  `/api/attendance`,
  `${window.location.protocol}//${window.location.hostname}:4007/api/attendance`,
  'http://127.0.0.1:4007/api/attendance',
  'http://localhost:4007/api/attendance',
  `${window.location.protocol}//${window.location.hostname}:4000/api/attendance`,
  'http://127.0.0.1:4000/api/attendance',
  'http://localhost:4000/api/attendance',
];

const requestAttendance = async (path: string, init?: RequestInit) => {
  let lastError: Error | null = null;
  for (const base of attendanceBases) {
    try {
      // Add a timeout so the request doesn't hang indefinitely when MySQL is slow
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Attendance API failed with status ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }
  throw lastError || new Error('Unable to reach backend attendance API');
};

export const fetchStudents = async () => {
  try {
    const response = await requestAttendance('/students');
    const students = await response.json();
    if (!Array.isArray(students)) return [];
    // normalize backend fields (index_no, photo_url, fingerprint_enrolled, face_enrolled)
    return students.map((s: any) => ({
      index: s.index_no || s.index || '',
      name: s.name,
      programme: s.programme,
      level: s.level,
      fingerprintEnrolled: s.fingerprintEnrolled ?? s.fingerprint_enrolled ?? false,
      faceEnrolled: s.faceEnrolled ?? s.face_enrolled ?? hasPhoto(s.photo ?? s.photo_url),
      photo: s.photo ?? s.photo_url ?? null,
    }));
  } catch {
    const db = await initDB();
    const students = await db.getAll('students');
    return students.map((student: any) => ({
      ...student,
      faceEnrolled: student.faceEnrolled ?? student.face_enrolled ?? hasPhoto(student.photo),
    }));
  }
};

export const addStudent = async (student: any) => {
  try {
    // convert to backend field names (biometric flags managed separately)
    const payload = {
      index_no: student.index,
      name: student.name,
      programme: student.programme,
      level: student.level,
      photo_url: student.photo ?? null,
    };

    const response = await requestAttendance('/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resJson = await response.json();
    return resJson;
  } catch {
    const db = await initDB();
    const existing = await db.get('students', student.index);
    const fingerprintEnrolled = student.fingerprintEnrolled ?? (existing ? existing.fingerprintEnrolled : false);
    const faceEnrolled = Boolean(student.faceEnrolled ?? (existing ? existing.faceEnrolled : false)) || hasPhoto(student.photo ?? existing?.photo);
    const result = await db.put('students', { ...student, fingerprintEnrolled, faceEnrolled });
    await persistDBBackup();
    return result;
  }
};

export const deleteStudent = async (index: string) => {
  try {
    const response = await requestAttendance(`/students/${encodeURIComponent(index)}`, {
      method: 'DELETE',
    });
    // backend returns a small json; if empty body, just return true
    try {
      const result = await response.json();
      // IMPORTANT: Also delete from IndexedDB to prevent offlineSync from re-syncing the student
      const db = await initDB();
      await db.delete('students', index);
      await persistDBBackup();
      return result;
    } catch {
      // Response was ok but not JSON - also delete from local storage
      const db = await initDB();
      await db.delete('students', index);
      await persistDBBackup();
      return { success: true };
    }
  } catch {
    // Backend deletion failed, fall back to local-only deletion
    const db = await initDB();
    const result = await db.delete('students', index);
    await persistDBBackup();
    return result;
  }
};