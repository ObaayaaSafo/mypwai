// Index: GET /students:56 | POST /students:72 | DELETE /students/:index:148 | GET /sessions:169
//        POST /sessions:177 | DELETE /sessions/:id:201 | GET /attendance:211 | POST /attendance:219
//        GET /scan-events:237 | POST /scan-events:247 | POST /verify:260
//        GET /malpractice:244 | GET /malpractice-summary:303 | GET /reports:512 | GET /summary:578
//        GET /export:348 | POST /import:361
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
    const sessions = await query('SELECT * FROM sessions');
    res.json(sessions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch sessions';
    res.status(500).json({ message });
  }
});

router.post('/sessions', async (req, res) => {
  const session = req.body as Session;
  if (!session?.course_code || !session?.session_date || !session?.session_time) {
    return res.status(400).json({ message: 'course_code, session_date, and session_time are required' });
  }

  try {
    if (session.id) {
      // Update existing
      await exec(
        'UPDATE sessions SET course = ?, course_code = ?, session_date = ?, session_time = ?, hall = ? WHERE id = ?',
        [session.course || null, session.course_code, session.session_date, session.session_time, session.hall || null, session.id]
      );
    } else {
      // Insert new
      await exec(
        'INSERT INTO sessions (course, course_code, session_date, session_time, hall) VALUES (?, ?, ?, ?, ?)',
        [session.course || null, session.course_code, session.session_date, session.session_time, session.hall || null]
      );
    }

    return res.json({ success: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save session';
    res.status(500).json({ message });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  const id = Number(req.params?.id);

  try {
    await exec('DELETE FROM sessions WHERE id = ?', [id]);
    return res.json({ success: true });
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
      'INSERT INTO attendance (student_id, course_code, attendance_date, attendance_time, status) VALUES (?, ?, ?, ?, ?)',
      [record.student_id, record.course_code, record.attendance_date, record.attendance_time, record.status || 'Present']
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
      byType[type] = (byType[type] || 0) + 1;
      if (severity in bySeverity) bySeverity[severity]++;
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
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?)',
        [student.id, null, todayIso(), nowTime(), 'failed', 'fingerprint_not_enrolled']
      );
      return res.status(400).json({ message: 'Fingerprint not enrolled' });
    }

    if (method === 'face' && !resolveFaceEnrolled(student)) {
      await exec(
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result, reason) VALUES (?, ?, ?, ?, ?)',
        [student.id, null, todayIso(), nowTime(), 'failed', 'face_not_enrolled']
      );
      return res.status(403).json({ message: `Face not enrolled for ${student.name}` });
    }

    const todaySession = (await query(
      'SELECT course_code FROM sessions WHERE session_date = ? LIMIT 1',
      [todayIso()]
    )) as { course_code: string }[];

    const courseCode = todaySession[0]?.course_code || 'DEMO101';

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
        'INSERT INTO attendance (student_id, course_code, attendance_date, attendance_time, status) VALUES (?, ?, ?, ?, ?)',
        [student.id, courseCode, todayIso(), nowTime(), 'Present']
      );
      await conn.execute(
        'INSERT INTO scan_events (student_id, course_code, event_date, event_time, result) VALUES (?, ?, ?, ?, ?)',
        [student.id, courseCode, todayIso(), nowTime(), 'success']
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
              `INSERT INTO attendance (student_id, course_code, attendance_date, attendance_time, status) VALUES (?,?,?,?,?)`,
              [studentIdNum, courseCode, attDate, attTime, status]
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
    const courseCode = typeof req.query.courseCode === 'string' ? req.query.courseCode.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

    let sql = `
      SELECT a.id, a.course_code, a.attendance_date, a.attendance_time, a.status,
             s.index_no, s.name, s.programme, s.level
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (courseCode) {
      sql += ' AND a.course_code = ?';
      params.push(courseCode);
    }
    if (date) {
      sql += ' AND a.attendance_date = ?';
      params.push(date);
    }

    sql += ' ORDER BY a.attendance_time ASC';

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

    // Get all students to fill in absentees
    const allStudents = await query('SELECT index_no, name, programme, level FROM students ORDER BY index_no') as any[];
    const presentIds = new Set(records.map((r: any) => r.studentId));
    const absentRecords = allStudents
      .filter((s: any) => !presentIds.has(s.index_no))
      .map((s: any) => ({
        studentId: s.index_no,
        name: s.name,
        programme: s.programme || '',
        level: s.level || '',
        status: 'Absent',
        time: '-',
        date: date || '',
        courseCode: courseCode || '',
      }));

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

export default router;
