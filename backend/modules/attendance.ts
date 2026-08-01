// Index: GET /students:56 | POST /students:72 | DELETE /students/:index:148 | GET /sessions:169
//        POST /sessions:177 | DELETE /sessions/:id:201 | GET /attendance:211 | POST /attendance:219
//        GET /scan-events:237 | POST /scan-events:247 | POST /verify:260
//        GET /malpractice:244 | GET /malpractice-summary:303 | GET /reports:512 | GET /summary:578
//        GET /export:348 | POST /import:361
//        GET /student-courses:598 | POST /student-courses:622 | DELETE /student-courses:650
//        GET /student-courses/courses:660
import express from 'express';
import { query, exec, transaction } from '../db.js';
import type { Connection } from 'mysql2/promise';

type Student = {
  id?: number;
  index_no: string;
  name: string;
  programme?: string;
  level?: string;
  fingerprint_enrolled?: boolean;
  face_enrolled?: boolean;
  photo_url?: string;
};

type Session = {
  id: number;
  course: string;
  course_code: string;
  session_date: string;
  session_time: string;
  hall: string;
};

type AttendanceRecord = {
  id?: number;
  student_id: number;
  course_code: string;
  attendance_date: string;
  attendance_time: string;
  status: 'Present' | 'Absent';
};

type ScanEvent = {
  id?: number;
  student_id?: number;
  course_code?: string;
  event_date: string;
  event_time: string;
  result: 'success' | 'failed' | 'duplicate' | 'enrollment';
  reason?: string;
};

const router = express.Router();

const todayIso = () => new Date().toISOString().split('T')[0] || '1970-01-01';
const nowTime = () => new Date().toTimeString().split(' ')[0]; // HH:MM:SS 24h

const hasPhoto = (photoUrl?: string | null) => typeof photoUrl === 'string' && photoUrl.trim().length > 0;

const resolveFaceEnrolled = (student: { face_enrolled?: boolean; faceEnrolled?: boolean; photo_url?: string | null }) =>
  Boolean(student.face_enrolled ?? student.faceEnrolled ?? false) || hasPhoto(student.photo_url);

const resolveFingerprintEnrolled = (student: { fingerprint_enrolled?: boolean; fingerprintEnrolled?: boolean }) =>
  Boolean(student.fingerprint_enrolled ?? student.fingerprintEnrolled ?? false);

router.get('/students', async (_req, res) => {
  try {
    const students = await query('SELECT * FROM students');
    res.json(
      (Array.isArray(students) ? students : []).map((student: any) => ({
        ...student,
        fingerprintEnrolled: resolveFingerprintEnrolled(student),
        faceEnrolled: resolveFaceEnrolled(student),
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch students';
    res.status(500).json({ message });
  }
});

router.post('/students', async (req, res) => {
  const student = req.body as Student;
  if (!student?.index_no || !student?.name) {
    return res.status(400).json({ message: 'index_no and name are required' });
  }

  try {
    const existing = (await query('SELECT id FROM students WHERE index_no = ?', [
      student.index_no,
    ])) as { id: number }[];

    // Prevent creating/updating a student if it's been permanently deleted
    try {
      const deleted = (await query('SELECT index_no FROM deleted_students WHERE index_no = ?', [student.index_no])) as any[];
      if (deleted && deleted.length > 0) {
        return res.status(410).json({ message: 'This student was permanently deleted and cannot be recreated' });
      }
    } catch (e) {
      // If table doesn't exist yet, proceed normally
    }
    const faceEnrolled = resolveFaceEnrolled(student);
    const fingerprintEnrolled = resolveFingerprintEnrolled(student);

    if (existing.length > 0) {
      // Update existing (don't overwrite biometric flags managed by fingerprint module)
      await exec(
        'UPDATE students SET name = ?, programme = ?, level = ?,  photo_url = ? WHERE index_no = ?',
        [
          student.name,
          student.programme || null,
          student.level || null,
          student.photo_url || null,
          student.index_no,
        ]
      );
    } else {
      // Insert new
      await exec(
        'INSERT INTO students (index_no, name, programme, level, fingerprint_enrolled, face_enrolled, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          student.index_no,
          student.name,
          student.programme || null,
          student.level || null,
          fingerprintEnrolled,
          faceEnrolled,
          student.photo_url || null,
        ]
      );
    }

    return res.json({ success: true, student });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save student';
    res.status(500).json({ message });
  }
});

router.delete('/students/:index', async (req, res) => {
  const index = String(req.params?.index || '').trim();

  try {
    // Permanently remove the student and record the deletion to prevent later re-import
    await exec('DELETE FROM students WHERE index_no = ?', [index]);
    try {
      await exec('INSERT INTO deleted_students (index_no) VALUES (?) ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP', [index]);
    } catch (e) {
      // If the deleted_students table doesn't exist yet (migration not run), ignore
    }
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete student';
    res.status(500).json({ message });
  }
});

router.get('/sessions', async (_req, res) => {
  try {
    const sessions = await query(`
      SELECT s.*, sl.locked_by, sl.locked_at
      FROM sessions s
      LEFT JOIN session_locks sl ON sl.session_id = s.id
      ORDER BY s.session_date DESC, s.session_time ASC
    `);
    res.json(sessions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch sessions';
    res.status(500).json({ message });
  }
});

router.post('/sessions', async (req, res) => {
  const session = req.body as Session;
  // Normalize course code to uppercase
  const courseCode = (session.course_code || '').toUpperCase();
  if (!courseCode || !session?.session_date || !session?.session_time) {
    return res.status(400).json({ message: 'course_code, session_date, and session_time are required' });
  }

  try {
    let generatedId = session.id || 0;
    if (session.id) {
      await exec(
        'INSERT INTO sessions (id, course, course_code, session_date, session_time, hall) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE course = VALUES(course), course_code = VALUES(course_code), session_date = VALUES(session_date), session_time = VALUES(session_time), hall = VALUES(hall)',
        [session.id, session.course || null, courseCode, session.session_date, session.session_time, session.hall || null]
      );
    } else {
      const result = await exec(
        'INSERT INTO sessions (course, course_code, session_date, session_time, hall) VALUES (?, ?, ?, ?, ?)',
        [session.course || null, courseCode, session.session_date, session.session_time, session.hall || null]
      ) as any;
      generatedId = result?.insertId || 0;
    }

    return res.json({ success: true, session: { ...session, id: generatedId, course_code: courseCode } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save session';
    res.status(500).json({ message });
  }
});

/**
 * DELETE /api/attendance/attendance?courseCode=X&date=Y
 * Clear attendance records for a course on a specific date
 */
router.delete('/attendance', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const sessionId = typeof req.query.sessionId === 'string' ? Number(req.query.sessionId.trim()) : NaN;
    if ((!courseCode || !date) && !sessionId) {
      return res.status(400).json({ message: 'courseCode and date are required, or sessionId' });
    }
    let attResult: any, scanResult: any;
    if (sessionId && !isNaN(sessionId)) {
      attResult = await exec('DELETE FROM attendance WHERE session_id = ?', [sessionId]) as any;
      scanResult = await exec('DELETE FROM scan_events WHERE session_id = ?', [sessionId]) as any;
      // Also clean legacy records
      await exec('DELETE FROM attendance WHERE session_id IS NULL AND course_code = ? AND attendance_date = ?', [courseCode, date]);
      await exec('DELETE FROM scan_events WHERE session_id IS NULL AND course_code = ? AND event_date = ?', [courseCode, date]);
    } else {
      attResult = await exec('DELETE FROM attendance WHERE course_code = ? AND attendance_date = ?', [courseCode, date]) as any;
      scanResult = await exec('DELETE FROM scan_events WHERE course_code = ? AND event_date = ?', [courseCode, date]) as any;
    }
    res.json({ 
      success: true, 
      attendanceDeleted: attResult?.affectedRows || 0,
      scanEventsDeleted: scanResult?.affectedRows || 0
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed' });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  const id = Number(req.params?.id);

  try {
    // Get session details before deleting
    const sessions = await query('SELECT course_code, session_date FROM sessions WHERE id = ?', [id]) as { course_code: string; session_date: string }[];
    if (sessions.length === 0) return res.status(404).json({ message: 'Session not found' });

    const sessionRow = sessions[0]!;
    const courseCode = sessionRow.course_code;
    const sessionDate = sessionRow.session_date;

    // Delete the session (FKs on session_locks, attendance.session_id, scan_events.session_id will cascade or set NULL)
    await exec('DELETE FROM sessions WHERE id = ?', [id]);

    // Delete session lock explicitly (has ON DELETE CASCADE on FK)
    await exec('DELETE FROM session_locks WHERE session_id = ?', [id]);

    // Delete attendance + scan events by session_id (precise cascade)
    const attResult = await exec('DELETE FROM attendance WHERE session_id = ?', [id]) as any;
    const scanResult = await exec('DELETE FROM scan_events WHERE session_id = ?', [id]) as any;

    // Also clean up any legacy records (no session_id) that match this course+date
    const attLegacy = await exec('DELETE FROM attendance WHERE session_id IS NULL AND course_code = ? AND attendance_date = ?', [courseCode, sessionDate]) as any;
    const scanLegacy = await exec('DELETE FROM scan_events WHERE session_id IS NULL AND course_code = ? AND event_date = ?', [courseCode, sessionDate]) as any;

    // If no other sessions exist for this course, clean up enrollments too
    const remaining = await query('SELECT COUNT(*) as cnt FROM sessions WHERE course_code = ?', [courseCode]) as any[];
    let enrollmentsCleared = 0;
    if (remaining[0]?.cnt === 0) {
      const enrollResult = await exec('DELETE FROM student_courses WHERE course_code = ?', [courseCode]) as any;
      enrollmentsCleared = enrollResult?.affectedRows || 0;
    }

    res.json({
      success: true,
      attendanceDeleted: (attResult?.affectedRows || 0) + (attLegacy?.affectedRows || 0),
      scanEventsDeleted: (scanResult?.affectedRows || 0) + (scanLegacy?.affectedRows || 0),
      enrollmentsCleared,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    res.status(500).json({ message });
  }
});

router.get('/attendance', async (_req, res) => {
  try {
    const attendance = await query('SELECT * FROM attendance');
    res.json(attendance);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch attendance';
    res.status(500).json({ message });
  }
});

router.post('/attendance', async (req, res) => {
  const record = req.body as AttendanceRecord;
  if (!record?.student_id || !record?.course_code || !record?.attendance_date || !record?.attendance_time) {
    return res.status(400).json({ message: 'student_id, course_code, attendance_date, and attendance_time are required' });
  }

  try {
    await exec(
      'INSERT INTO attendance (student_id, course_code, session_id, attendance_date, attendance_time, status) VALUES (?, ?, ?, ?, ?, ?)',
      [record.student_id, record.course_code, (record as any).session_id || null, record.attendance_date, record.attendance_time, record.status || 'Present']
    );

    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save attendance';
    res.status(500).json({ message });
  }
});

router.get('/scan-events', async (_req, res) => {
  try {
    const events = await query('SELECT * FROM scan_events ORDER BY event_date DESC, event_time DESC');
    res.json(events);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch scan events';
    res.status(500).json({ message });
  }
});

// ========== MALPRACTICE QUERIES ==========

/**
 * GET /api/attendance/malpractice?courseCode=&date=
 * Extracts malpractice events from scan_events (stored with reason prefix 'malpractice:')
 */
router.get('/malpractice', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

    let sql = `
      SELECT se.id, se.student_id, se.course_code, se.event_date, se.event_time, se.reason,
             s.index_no, s.name
      FROM scan_events se
      LEFT JOIN students s ON s.id = se.student_id
      WHERE se.reason LIKE 'malpractice:%'
    `;
    const params: any[] = [];

    if (courseCode) { sql += ' AND se.course_code = ?'; params.push(courseCode); }
    if (date) { sql += ' AND se.event_date = ?'; params.push(date); }
    sql += ' ORDER BY se.event_date DESC, se.event_time DESC LIMIT 200';

    const rows = await query(sql, params) as any[];

    // Parse the compound reason string: malpractice:<eventType>|severity:<severity>|score:<score>|<detail>
    const events = rows.map((r: any) => {
      const reason = String(r.reason || '');
      const parts: Record<string, string> = {};
      reason.split('|').forEach((segment: string) => {
        const [key, ...rest] = segment.split(':');
        if (key && rest.length > 0) parts[key.trim()] = rest.join(':').trim();
      });

      return {
        id: r.id,
        studentId: r.index_no || (r.student_id ? String(r.student_id) : null),
        studentName: r.name || 'Unknown',
        courseCode: r.course_code,
        date: r.event_date,
        time: r.event_time,
        eventType: parts.malpractice || 'unknown',
        severity: parts.severity || 'low',
        score: parseFloat(parts.score || '0'),
        detail: parts[''] || reason.replace(/^malpractice:.*?\|/, ''),
      };
    });

    res.json(events);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch malpractice events';
    res.status(500).json({ message });
  }
});

/**
 * GET /api/attendance/malpractice-summary?courseCode=&date=
 * Aggregated malpractice stats
 */
router.get('/malpractice-summary', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

    let sql = `
      SELECT reason FROM scan_events
      WHERE reason LIKE 'malpractice:%'
    `;
    const params: any[] = [];
    if (courseCode) { sql += ' AND course_code = ?'; params.push(courseCode); }
    if (date) { sql += ' AND event_date = ?'; params.push(date); }

    const rows = await query(sql, params) as any[];

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = { high: 0, medium: 0, low: 0 };
    const flaggedStudents = new Set<string>();

    rows.forEach((r: any) => {
      const reason = String(r.reason || '');
      const parts: Record<string, string> = {};
      reason.split('|').forEach((segment: string) => {
        const [key, ...rest] = segment.split(':');
        if (key && rest.length > 0) parts[key.trim()] = rest.join(':').trim();
      });

      const type = parts.malpractice || 'unknown';
      const severity = (parts.severity || 'low') as string;
      const current = byType[type];
      byType[type] = (current !== undefined ? current : 0) + 1;
      if (severity in bySeverity) bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    });

    res.json({
      totalEvents: rows.length,
      byType,
      bySeverity,
      topTypes: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get malpractice summary';
    res.status(500).json({ message });
  }
});

router.post('/scan-events', async (req, res) => {
  const event = req.body as ScanEvent;
  if (!event?.event_date || !event?.event_time || !event?.result) {
    return res.status(400).json({ message: 'event_date, event_time, and result are required' });
  }

  try {
    await exec(
      'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [event.student_id || null, event.course_code || null, event.event_date, event.event_time, event.result, event.reason || null]
    );

    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save scan event';
    res.status(500).json({ message });
  }
});

router.post('/verify', async (req, res) => {
  const studentIndex = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
  if (!studentIndex) {
    return res.status(400).json({ message: 'studentId is required' });
  }

  // Determine verification method (default to 'fingerprint')
  const method: 'fingerprint' | 'face' = req.body?.method === 'face' ? 'face' : 'fingerprint';

  try {
    // Find student by index_no (include enrollment fields)
    const students = (await query(
      'SELECT id, name, index_no, fingerprint_enrolled, face_enrolled, photo_url FROM students WHERE index_no = ?',
      [studentIndex]
    )) as { id: number; name: string; index_no: string; fingerprint_enrolled: boolean; face_enrolled: boolean; photo_url?: string | null }[];

    if (students.length === 0) {
      // Log failed event
      await exec(
        'INSERT INTO scan_events (course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?)',
        [null, todayIso(), nowTime(), 'failed', 'student_not_found']
      );
      return res.status(404).json({ message: 'Student not found' });
    }

    const student = students[0];
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check enrollment based on method
    if (method === 'fingerprint' && !resolveFingerprintEnrolled(student)) {
      await exec(
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [student.id, null, todayIso(), nowTime(), 'failed', 'fingerprint_not_enrolled']
      );
      return res.status(400).json({ message: 'Fingerprint not enrolled' });
    }

    if (method === 'face' && !resolveFaceEnrolled(student)) {
      await exec(
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [student.id, null, todayIso(), nowTime(), 'failed', 'face_not_enrolled']
      );
      return res.status(403).json({ message: `Face not enrolled for ${student.name}` });
    }

    const todaySession = (await query(
      'SELECT id, course_code FROM sessions WHERE session_date = ? LIMIT 1',
      [todayIso()]
    )) as { id: number; course_code: string }[];

    const courseCode = todaySession[0]?.course_code || 'DEMO101';
    const sessionId = todaySession[0]?.id || null;

    // Check course enrollment
    try {
      const enrollment = await query(
        'SELECT 1 FROM student_courses WHERE student_id = ? AND course_code = ? LIMIT 1',
        [student.id, courseCode]
      ) as any[];
      if (enrollment.length === 0) {
        return res.status(403).json({ message: `${student.name} (${student.index_no}) is not enrolled in ${courseCode}` });
      }
    } catch {
      // student_courses table may not exist — allow attendance anyway
    }

    // Check for duplicate attendance
    const duplicates = (await query(
      'SELECT id FROM attendance WHERE student_id = ? AND course_code = ? AND attendance_date = ? AND status = ?',
      [student.id, courseCode, todayIso(), 'Present']
    )) as { id: number }[];

    if (duplicates.length > 0) {
      await exec(
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [student.id, courseCode, todayIso(), nowTime(), 'duplicate', 'duplicate_check_in']
      );
      return res.json({ message: `Duplicate scan detected for ${student.name}` });
    }

    // Record attendance using transaction
    await transaction(async (conn) => {
      await conn.execute(
        'INSERT INTO attendance (student_id, course_code, session_id, attendance_date, attendance_time, status) VALUES (?, ?, ?, ?, ?, ?)',
        [student.id, courseCode, sessionId ?? null, todayIso(), nowTime(), 'Present'] as any
      );
      await conn.execute(
        'INSERT INTO scan_events (student_id, course_code, session_id, event_date, event_time, result) VALUES (?, ?, ?, ?, ?, ?)',
        [student.id, courseCode, sessionId ?? null, todayIso(), nowTime(), 'success'] as any
      );
    });

    return res.json({ message: `Verified: ${student.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    res.status(500).json({ message });
  }
});

// ========== BULK EXPORT / IMPORT for Dashboard sync ==========

/**
 * GET /api/attendance/export - Returns all data as JSON
 */
router.get('/export', async (_req, res) => {
  try {
    const [students, sessions, attendance, scanEvents] = await Promise.all([
      query('SELECT * FROM students ORDER BY index_no'),
      query('SELECT * FROM sessions ORDER BY id'),
      query('SELECT * FROM attendance ORDER BY id'),
      query('SELECT * FROM scan_events ORDER BY id'),
    ]);
    return res.json({ students, sessions, attendance, scanEvents });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed';
    res.status(500).json({ message });
  }
});

/**
 * POST /api/attendance/import - Bulk import data, skipping duplicates
 */
router.post('/import', async (req, res) => {
  try {
    const { students, sessions, attendance } = req.body;
    const result = {
      added: { students: 0, sessions: 0, attendance: 0 },
      duplicates: { students: 0, sessions: 0, attendance: 0 },
      errors: [] as string[],
    };

    // Import students
    if (Array.isArray(students)) {
      for (const s of students) {
        const indexNo = String(s.index_no || s.index || '').trim();
        if (!indexNo) continue;
        try {
          // Skip students that were permanently deleted
          try {
            const deleted = (await query('SELECT index_no FROM deleted_students WHERE index_no = ?', [indexNo])) as any[];
            if (deleted && deleted.length > 0) {
              result.duplicates.students++;
              continue;
            }
          } catch (e) {
            // ignore if table missing
          }
          const existing = (await query('SELECT id FROM students WHERE index_no = ?', [indexNo])) as any[];
          if (existing.length > 0) {
            result.duplicates.students++;
            // Don't overwrite biometric flags — managed by fingerprint module
            await exec(
              `UPDATE students SET name=?, programme=?, level=?, photo_url=? WHERE index_no=?`,
              [
                s.name || 'Unknown',
                s.programme || null,
                s.level || null,
                s.photo_url || s.photo || null,
                indexNo,
              ]
            );
          } else {
            await exec(
              `INSERT INTO students (index_no, name, programme, level, fingerprint_enrolled, face_enrolled, photo_url) VALUES (?,?,?,?,?,?,?)`,
              [
                indexNo,
                s.name || 'Unknown',
                s.programme || null,
                s.level || null,
                s.fingerprint_enrolled ?? s.fingerprintEnrolled ?? false,
                s.face_enrolled ?? s.faceEnrolled ?? false,
                s.photo_url || s.photo || null,
              ]
            );
            result.added.students++;
          }
        } catch (err: any) {
          result.errors.push(`Student ${indexNo}: ${err.message}`);
        }
      }
    }

    // Import sessions
    if (Array.isArray(sessions)) {
      for (const s of sessions) {
        const courseCode = String(s.course_code || s.courseCode || '').trim();
        const sessionDate = String(s.session_date || s.date || '').trim();
        const sessionTime = String(s.session_time || s.time || '').trim();
        if (!courseCode || !sessionDate || !sessionTime) continue;
        try {
          const existing = (await query(
            'SELECT id FROM sessions WHERE course_code=? AND session_date=? AND session_time=?',
            [courseCode, sessionDate, sessionTime]
          )) as any[];
          if (existing.length > 0) {
            result.duplicates.sessions++;
            await exec(
              `UPDATE sessions SET course=?, hall=? WHERE id=?`,
              [s.course || null, s.hall || null, existing[0].id]
            );
          } else {
            await exec(
              `INSERT INTO sessions (course, course_code, session_date, session_time, hall) VALUES (?,?,?,?,?)`,
              [s.course || null, courseCode, sessionDate, sessionTime, s.hall || null]
            );
            result.added.sessions++;
          }
        } catch (err: any) {
          result.errors.push(`Session ${courseCode} ${sessionDate}: ${err.message}`);
        }
      }
    }

    // Import attendance
    if (Array.isArray(attendance)) {
      for (const a of attendance) {
        let studentIdNum = a.student_id;
        if (!studentIdNum && (a.studentId || a.index || a.index_no)) {
          const idx = String(a.studentId || a.index || a.index_no || '').trim();
          const found = (await query('SELECT id FROM students WHERE index_no = ?', [idx])) as any[];
          if (found.length === 0) {
            result.errors.push(`Attendance: student ${idx} not found, skipped`);
            continue;
          }
          studentIdNum = found[0].id;
        }
        if (!studentIdNum) continue;

        const courseCode = String(a.course_code || a.courseCode || '').trim();
        const attDate = String(a.attendance_date || a.date || '').trim();
        const attTime = String(a.attendance_time || a.time || '').trim();
        const status = (String(a.status || 'Present') === 'Absent' ? 'Absent' : 'Present') as 'Present' | 'Absent';
        if (!courseCode || !attDate || !attTime) continue;

        try {
          const existing = (await query(
            'SELECT id FROM attendance WHERE student_id=? AND course_code=? AND attendance_date=? AND status=?',
            [studentIdNum, courseCode, attDate, status]
          )) as any[];
          if (existing.length > 0) {
            result.duplicates.attendance++;
          } else {
            await exec(
              `INSERT INTO attendance (student_id, course_code, session_id, attendance_date, attendance_time, status) VALUES (?,?,?,?,?,?)`,
              [studentIdNum, courseCode, (a as any).session_id || null, attDate, attTime, status]
            );
            result.added.attendance++;
          }
        } catch (err: any) {
          result.errors.push(`Attendance ${courseCode} ${attDate}: ${err.message}`);
        }
      }
    }

    return res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed';
    res.status(500).json({ message });
  }
});

// ========== REPORTS ==========

/**
 * GET /api/attendance/reports?courseCode=&date=
 * Returns attendance records JOINed with student info, properly filtered.
 */
router.get('/reports', async (req, res) => {
  try {
    let courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    let date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';

    // Resolve courseCode/date from session if sessionId provided
    let sessionDate: string = '';
    if (sessionId) {
      try {
        const sessionRows = await query(
          'SELECT course_code, session_date FROM sessions WHERE id = ?',
          [Number(sessionId)]
        ) as { course_code: string; session_date: string }[];
        if (sessionRows.length > 0) {
          const sr = sessionRows[0]!;
          if (!courseCode) courseCode = (sr.course_code || '').toUpperCase();
          const d: any = sr.session_date;
          sessionDate = d instanceof Date ? d.toISOString().split('T')[0]! : String(d).split('T')[0]!;
        }
      } catch { /* session lookup failed — proceed with provided values */ }
    }

    // When sessionId resolves, use the session's date (overrides frontend's default date)
    const effectiveDate = sessionDate || date;

    console.log(`[Reports] courseCode=${courseCode} date=${date} sessionDate=${sessionDate} sessionId=${sessionId}`);

    // Build dynamic query based on available filters
    let sql = `
      SELECT a.id, a.course_code, a.attendance_date, a.attendance_time, a.status,
             s.index_no, s.name, s.programme, s.level
      FROM attendance a
      JOIN students s ON s.id = a.student_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (courseCode) {
      conditions.push('a.course_code = ?');
      params.push(courseCode);
    }
    if (effectiveDate) {
      conditions.push('a.attendance_date = ?');
      params.push(effectiveDate);
    }
    if (sessionId) {
      conditions.push('a.session_id = ?');
      params.push(Number(sessionId));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY a.attendance_date DESC, a.attendance_time ASC LIMIT 500';

    const rows = await query(sql, params) as any[];

    const records = rows.map((r: any) => ({
      studentId: r.index_no,
      name: r.name,
      programme: r.programme || '',
      level: r.level || '',
      status: r.status,
      time: r.attendance_time,
      date: r.attendance_date,
      courseCode: r.course_code,
    }));

    // Only compute absent students when a specific course is filtered
    let absentRecords: any[] = [];
    if (courseCode) {
      let enrolledStudents: any[] = [];
      try {
        enrolledStudents = await query(
          'SELECT s.index_no, s.name, s.programme, s.level FROM students s JOIN student_courses sc ON sc.student_id = s.id WHERE sc.course_code = ? ORDER BY s.index_no',
          [courseCode]
        ) as any[];
      } catch (err: any) {
        if (/doesn't exist|not found/i.test(err.message || '')) {
          enrolledStudents = await query('SELECT index_no, name, programme, level FROM students ORDER BY index_no') as any[];
        }
      }

      const presentIds = new Set(records.map((r: any) => r.studentId));
      absentRecords = enrolledStudents
        .filter((s: any) => !presentIds.has(s.index_no))
        .map((s: any) => ({
          studentId: s.index_no,
          name: s.name,
          programme: s.programme || '',
          level: s.level || '',
          status: 'Absent',
          time: '-',
          date: effectiveDate || '',
          courseCode: courseCode || '',
        }));
    }

    const allRecords = [...records, ...absentRecords].sort((a, b) => a.studentId.localeCompare(b.studentId));

    res.json(allRecords);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    res.status(500).json({ message });
  }
});

/**
 * GET /api/attendance/summary — Quick stats for the dashboard/reporting
 */
router.get('/summary', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

    const totalStudents = (await query('SELECT COUNT(*) AS cnt FROM students') as any[])[0]?.cnt ?? 0;

    let presentSql = 'SELECT COUNT(*) AS cnt FROM attendance WHERE status = ?';
    const params: any[] = ['Present'];
    if (courseCode) { presentSql += ' AND course_code = ?'; params.push(courseCode); }
    if (date) { presentSql += ' AND attendance_date = ?'; params.push(date); }
    const presentCount = (await query(presentSql, params) as any[])[0]?.cnt ?? 0;

    const firstArrival = date
      ? (await query(
          'SELECT MIN(attendance_time) AS t FROM attendance WHERE attendance_date = ? AND status = ?' + (courseCode ? ' AND course_code = ?' : ''),
          courseCode ? [date, 'Present', courseCode] : [date, 'Present']
        ) as any[])[0]?.t || '-'
      : '-';

    const lastArrival = date
      ? (await query(
          'SELECT MAX(attendance_time) AS t FROM attendance WHERE attendance_date = ? AND status = ?' + (courseCode ? ' AND course_code = ?' : ''),
          courseCode ? [date, 'Present', courseCode] : [date, 'Present']
        ) as any[])[0]?.t || '-'
      : '-';

    const absentCount = totalStudents - presentCount;
    const rate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

    res.json({ totalStudents, presentCount, absentCount, attendanceRate: rate, firstArrival, lastArrival });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get summary';
    res.status(500).json({ message });
  }
});

// ========== STUDENT COURSE ENROLLMENT ==========

/**
 * GET /api/attendance/student-courses?courseCode=X
 * Returns students enrolled in a specific course, or all course codes if no courseCode
 */
router.get('/student-courses', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';

    if (!courseCode) {
      const courses = await query(
        'SELECT DISTINCT sc.course_code FROM student_courses sc ORDER BY sc.course_code'
      ) as any[];
      return res.json({ courses: courses.map((c: any) => c.course_code) });
    }

    const students = await query(
      `SELECT s.id, s.index_no, s.name, s.programme, s.level
       FROM students s
       JOIN student_courses sc ON sc.student_id = s.id
       WHERE sc.course_code = ?
       ORDER BY s.index_no`,
      [courseCode]
    ) as any[];

    res.json(students);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch course enrollments';
    res.status(500).json({ message });
  }
});

/**
 * GET /api/attendance/student-courses/courses
 * Returns all course codes that have at least one enrolled student
 */
router.get('/student-courses/courses', async (_req, res) => {
  try {
    const courses = await query(
      'SELECT DISTINCT sc.course_code FROM student_courses sc ORDER BY sc.course_code'
    ) as any[];
    res.json({ courses: courses.map((c: any) => c.course_code) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch courses';
    res.status(500).json({ message });
  }
});

/**
 * POST /api/attendance/student-courses
 * Body: { courseCode: string, studentIds: string[] }
 * Bulk assign students to a course (by index_no)
 */
router.post('/student-courses', async (req, res) => {
  try {
    const { courseCode, studentIds } = req.body;
    if (!courseCode || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'courseCode and studentIds array are required' });
    }

    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const indexNo of studentIds) {
      try {
        const rows = await query('SELECT id FROM students WHERE index_no = ?', [String(indexNo).trim()]) as any[];
        if (rows.length === 0) {
          skipped++;
          errors.push(`Student ${indexNo}: not found`);
          continue;
        }
        const studentId = rows[0].id;
        await exec(
          'INSERT IGNORE INTO student_courses (student_id, course_code) VALUES (?, ?)',
          [studentId, courseCode]
        );
        added++;
      } catch (err: any) {
        skipped++;
        errors.push(`Student ${indexNo}: ${err.message || 'DB error'}`);
      }
    }

    res.json({ success: true, added, skipped, errors: errors.slice(0, 10) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign students to course';
    res.status(500).json({ message });
  }
});

/**
 * DELETE /api/attendance/student-courses?courseCode=X&studentIds=ID1,ID2
 * Remove students from a course
 */
router.delete('/student-courses', async (req, res) => {
  try {
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const idsParam = typeof req.query.studentIds === 'string' ? req.query.studentIds : '';
    const studentIds = idsParam.split(',').map(id => id.trim()).filter(id => id.length > 0);

    if (!courseCode || studentIds.length === 0) {
      return res.status(400).json({ message: 'courseCode and studentIds are required' });
    }

    let removed = 0;
    for (const indexNo of studentIds) {
      const rows = await query('SELECT id FROM students WHERE index_no = ?', [String(indexNo)]) as any[];
      if (rows.length === 0) continue;
      const studentId = rows[0].id;
      await exec(
        'DELETE FROM student_courses WHERE student_id = ? AND course_code = ?',
        [studentId, courseCode]
      );
      removed++;
    }

    res.json({ success: true, removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove students from course';
    res.status(500).json({ message });
  }
});

// ========== SESSION LOCKS ==========

router.post('/session-lock', async (req, res) => {
  try {
    const { sessionId, username, role } = req.body;
    if (!sessionId || !username) return res.status(400).json({ message: 'sessionId and username required' });

    // Admin always bypasses
    if (role === 'admin') {
      await exec('DELETE FROM session_locks WHERE session_id = ?', [sessionId]);
      await exec('INSERT INTO session_locks (session_id, locked_by) VALUES (?, ?) ON DUPLICATE KEY UPDATE locked_by = ?, locked_at = CURRENT_TIMESTAMP', [sessionId, username, username]);
      return res.json({ success: true, lockedBy: username });
    }

    const existing = await query('SELECT locked_by FROM session_locks WHERE session_id = ?', [sessionId]) as any[];
    if (existing.length > 0 && existing[0].locked_by !== username) {
      return res.json({ success: false, lockedBy: existing[0].locked_by });
    }

    await exec('INSERT INTO session_locks (session_id, locked_by) VALUES (?, ?) ON DUPLICATE KEY UPDATE locked_by = ?, locked_at = CURRENT_TIMESTAMP', [sessionId, username, username]);
    res.json({ success: true, lockedBy: username });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed' });
  }
});

router.delete('/session-lock/:sessionId', async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const { username, role } = req.body;
    const existing = await query('SELECT locked_by FROM session_locks WHERE session_id = ?', [sessionId]) as any[];
    if (existing.length === 0) return res.json({ success: true });
    if (existing[0].locked_by !== username && role !== 'admin') {
      return res.json({ success: false, message: `Locked by ${existing[0].locked_by}` });
    }
    await exec('DELETE FROM session_locks WHERE session_id = ?', [sessionId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed' });
  }
});

router.get('/session-lock/:sessionId', async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const existing = await query('SELECT locked_by, locked_at FROM session_locks WHERE session_id = ?', [sessionId]) as any[];
    res.json(existing.length > 0 ? { locked: true, lockedBy: existing[0].locked_by } : { locked: false });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed' });
  }
});

export default router;
