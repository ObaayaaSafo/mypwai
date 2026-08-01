import { openDB, DBSchema } from 'idb';

const BACKUP_KEY = 'examsys-db-backup-v1';
let restoreAttempted = false;

interface ExamSysDB extends DBSchema {
  students: {
    key: string;
    value: {
      index: string;
      name: string;
      programme: string;
      level: string;
      fingerprintEnrolled?: boolean;
      faceEnrolled?: boolean;
      photo?: string;
    };
  };
  attendance: {
    key: number;
    value: {
      studentId: string;
      courseCode: string;
      date: string;
      time: string;
      status: 'Present' | 'Absent';
    };
    indexes: { 'by-date': string; 'by-course': string };
  };
  sessions: {
    key: number;
    value: {
      id: number;
      course: string;
      courseCode: string;
      date: string;
      time: string;
      hall: string;
    };
  };
  users: {
    key: string;
    value: {
      username: string;
      password: string;
      fullName: string;
      email: string;
    };
  };
  scanEvents: {
    key: number;
    value: {
      id?: number;
      studentId?: string;
      courseCode?: string;
      sessionId?: string;
      date: string;
      time: string;
      result: 'success' | 'failed' | 'duplicate' | 'enrollment';
      reason?: string;
    };
    indexes: { 'by-date': string; 'by-student': string; 'by-result': string };
  };
}

export const initDB = async () => {
  const db = await openDB<ExamSysDB>('examsys-db', 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('students')) {
        db.createObjectStore('students', { keyPath: 'index' });
      }
      if (!db.objectStoreNames.contains('attendance')) {
        const store = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-date', 'date');
        store.createIndex('by-course', 'courseCode');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'username' });
      }
      if (!db.objectStoreNames.contains('scanEvents')) {
        const store = db.createObjectStore('scanEvents', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-date', 'date');
        store.createIndex('by-student', 'studentId');
        store.createIndex('by-result', 'result');
      }
    },
  });

  await restoreBackupIfNeeded(db);
  return db;
};

const canUseBrowserStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const restoreBackupIfNeeded = async (db: Awaited<ReturnType<typeof openDB<ExamSysDB>>>) => {
  if (restoreAttempted || !canUseBrowserStorage()) return;
  restoreAttempted = true;

  const backup = localStorage.getItem(BACKUP_KEY);
  if (!backup) return;

  try {
    const parsed = JSON.parse(backup) as {
      students?: ExamSysDB['students']['value'][];
      sessions?: ExamSysDB['sessions']['value'][];
      attendance?: ExamSysDB['attendance']['value'][];
      users?: ExamSysDB['users']['value'][];
      scanEvents?: ExamSysDB['scanEvents']['value'][];
    };

    const [studentsCount, sessionsCount, attendanceCount, usersCount, scanEventsCount] = await Promise.all([
      db.count('students'),
      db.count('sessions'),
      db.count('attendance'),
      db.count('users'),
      db.count('scanEvents'),
    ]);

    const hasLiveData = studentsCount + sessionsCount + attendanceCount + usersCount + scanEventsCount > 0;
    if (hasLiveData) return;

    const tx = db.transaction(['students', 'sessions', 'attendance', 'users', 'scanEvents'], 'readwrite');

    for (const item of parsed.students || []) {
      await tx.objectStore('students').put(item);
    }
    for (const item of parsed.sessions || []) {
      await tx.objectStore('sessions').put(item);
    }
    for (const item of parsed.attendance || []) {
      await tx.objectStore('attendance').put(item);
    }
    for (const item of parsed.users || []) {
      await tx.objectStore('users').put(item);
    }
    for (const item of parsed.scanEvents || []) {
      await tx.objectStore('scanEvents').put(item);
    }

    await tx.done;
  } catch {
    // Ignore invalid backup payloads silently.
  }
};

export const persistDBBackup = async () => {
  if (!canUseBrowserStorage()) return;

  const db = await initDB();
  const [students, sessions, attendance, users, scanEvents] = await Promise.all([
    db.getAll('students'),
    db.getAll('sessions'),
    db.getAll('attendance'),
    db.getAll('users'),
    db.getAll('scanEvents'),
  ]);

  localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      students,
      sessions,
      attendance,
      users,
      scanEvents,
    })
  );
};
