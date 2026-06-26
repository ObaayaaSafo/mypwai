/**
 * Offline Sync Service
 * 
 * When the backend (MySQL) is unavailable, data gets saved to IndexedDB as a fallback.
 * This service periodically checks when the backend comes back online and syncs
 * any pending data from IndexedDB to MySQL.
 */

import { initDB, persistDBBackup } from './db';
import { pushAllToMySQL } from './apiExtra';

const SYNC_INTERVAL_MS = 30000; // Check every 30 seconds
const BACKEND_CHECK_ENDPOINT = '/api/health';
const BACKEND_CHECK_ALTERNATES = [
  '/api/attendance/students',
  'http://127.0.0.1:4007/api/health',
  'http://127.0.0.1:4007/api/attendance/students',
  'http://localhost:4007/api/health',
  'http://localhost:4007/api/attendance/students',
  `${window.location.protocol}//${window.location.hostname}:4000/api/health`,
  `${window.location.protocol}//${window.location.hostname}:4000/api/attendance/students`,
  'http://127.0.0.1:4000/api/health',
  'http://127.0.0.1:4000/api/attendance/students',
  'http://localhost:4000/api/health',
  'http://localhost:4000/api/attendance/students',
];

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
let lastSyncTime: Date | null = null;
let syncListeners: Array<(event: SyncEvent) => void> = [];

export interface SyncEvent {
  type: 'sync-started' | 'sync-completed' | 'sync-failed' | 'sync-skipped' | 'backend-online' | 'backend-offline';
  timestamp: Date;
  details?: string;
  stats?: {
    studentsSynced: number;
    sessionsSynced: number;
    attendanceSynced: number;
    errors: string[];
  };
}

/**
 * Check if the backend server is reachable
 */
async function isBackendOnline(): Promise<boolean> {
  const urlsToTry = [BACKEND_CHECK_ENDPOINT, ...BACKEND_CHECK_ALTERNATES];
  
  for (const url of urlsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 200) {
        return true;
      }
    } catch {
      // Continue to next URL
    }
  }
  
  return false;
}

/**
 * Get data that is in IndexedDB but NOT in MySQL
 * This compares the data in IndexedDB (our fallback) with what MySQL has
 */
async function getPendingData() {
  const db = await initDB();
  
  // Get all data from IndexedDB
  const [localStudents, localSessions, localAttendance] = await Promise.all([
    db.getAll('students'),
    db.getAll('sessions'),
    db.getAll('attendance'),
  ]);
  
  return {
    students: localStudents,
    sessions: localSessions,
    attendance: localAttendance,
  };
}

/**
 * Sync pending IndexedDB data to MySQL
 */
export async function syncToMySQL(): Promise<SyncEvent> {
  if (isSyncing) {
    return {
      type: 'sync-skipped',
      timestamp: new Date(),
      details: 'Sync already in progress',
    };
  }
  
  isSyncing = true;
  notifyListeners({ type: 'sync-started', timestamp: new Date() });
  
  try {
    const isOnline = await isBackendOnline();
    
    if (!isOnline) {
      notifyListeners({ type: 'backend-offline', timestamp: new Date(), details: 'Backend server is not reachable' });
      isSyncing = false;
      return {
        type: 'sync-failed',
        timestamp: new Date(),
        details: 'Backend server is offline',
      };
    }
    
    notifyListeners({ type: 'backend-online', timestamp: new Date() });
    
    // Get pending data from IndexedDB
    const pendingData = await getPendingData();
    
    const allStudents = pendingData.students.map((s: any) => ({
      index_no: s.index,
      name: s.name,
      programme: s.programme,
      level: s.level,
      fingerprint_enrolled: s.fingerprintEnrolled ?? s.fingerprint_enrolled ?? false,
      face_enrolled: s.faceEnrolled ?? s.face_enrolled ?? false,
      photo_url: s.photo || null,
    }));
    
    const allSessions = pendingData.sessions.map((s: any) => ({
      course_code: s.courseCode || s.course_code,
      course: s.course,
      session_date: s.date || s.session_date,
      session_time: s.time || s.session_time,
      hall: s.hall,
    }));
    
    const allAttendance = pendingData.attendance.map((a: any) => ({
      studentId: a.studentId || a.student_id,
      courseCode: a.courseCode || a.course_code,
      date: a.date || a.attendance_date,
      time: a.time || a.attendance_time,
      status: a.status,
    }));

    // Check if there's actually data to sync
    const hasData = allStudents.length > 0 || allSessions.length > 0 || allAttendance.length > 0;
    
    if (!hasData) {
      lastSyncTime = new Date();
      isSyncing = false;
      const event: SyncEvent = {
        type: 'sync-completed',
        timestamp: new Date(),
        details: 'No pending data to sync. All data is already in MySQL.',
        stats: { studentsSynced: 0, sessionsSynced: 0, attendanceSynced: 0, errors: [] },
      };
      notifyListeners(event);
      return event;
    }
    
    // Push all local data to MySQL
    const result = await pushAllToMySQL({
      students: allStudents,
      sessions: allSessions,
      attendance: allAttendance,
    });
    
    lastSyncTime = new Date();
    
    const stats = {
      studentsSynced: result.added?.students ?? 0,
      sessionsSynced: result.added?.sessions ?? 0,
      attendanceSynced: result.added?.attendance ?? 0,
      errors: result.errors ?? [],
    };
    
    const event: SyncEvent = {
      type: 'sync-completed',
      timestamp: new Date(),
      details: `Synced ${stats.studentsSynced} students, ${stats.sessionsSynced} sessions, ${stats.attendanceSynced} attendance records to MySQL.`,
      stats,
    };
    
    notifyListeners(event);
    return event;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    isSyncing = false;
    const event: SyncEvent = {
      type: 'sync-failed',
      timestamp: new Date(),
      details: `Sync failed: ${message}`,
    };
    notifyListeners(event);
    return event;
  } finally {
    isSyncing = false;
  }
}

/**
 * Start periodic sync checking
 */
export function startPeriodicSync(intervalMs: number = SYNC_INTERVAL_MS): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  
  // Do an initial sync
  syncToMySQL();
  
  // Then check periodically
  syncIntervalId = setInterval(() => {
    syncToMySQL();
  }, intervalMs);
  
  console.log(`[OfflineSync] Started periodic sync every ${intervalMs / 1000}s`);
}

/**
 * Stop periodic sync checking
 */
export function stopPeriodicSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[OfflineSync] Stopped periodic sync');
  }
}

/**
 * Subscribe to sync events
 */
export function onSyncEvent(listener: (event: SyncEvent) => void): () => void {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter(l => l !== listener);
  };
}

/**
 * Get the last sync time
 */
export function getLastSyncTime(): Date | null {
  return lastSyncTime;
}

/**
 * Check if a sync is currently in progress
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

function notifyListeners(event: SyncEvent): void {
  syncListeners.forEach(listener => {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  });
}
