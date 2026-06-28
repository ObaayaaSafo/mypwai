// Index: GET /:55 | POST /:76 | PUT /:index:133 | DELETE /:index:151
import express from 'express';
import { query, exec } from '../db.js';

type StudentRow = {
  id?: number;
  index_no: string;
  name: string;
  programme?: string;
  level?: string;
  fingerprint_enrolled?: boolean;
  face_enrolled?: boolean;
  photo_url?: string;
};

const router = express.Router();

// GET /api/students — Fetch all students
router.get('/', async (_req, res) => {
  try {
    const students = await query('SELECT * FROM students ORDER BY index_no');
    res.json(
      (Array.isArray(students) ? students : []).map((s: any) => ({
        index_no: s.index_no,
        name: s.name,
        programme: s.programme || '',
        level: s.level || '',
        fingerprintEnrolled: !!s.fingerprint_enrolled,
        faceEnrolled: !!s.face_enrolled,
        photo: s.photo_url || null,
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch students';
    res.status(500).json({ message });
  }
});

// POST /api/students — Add or update a student (upsert by index_no)
router.post('/', async (req, res) => {
  const student = req.body as StudentRow & { index?: string; photo?: string; fingerprintEnrolled?: boolean; faceEnrolled?: boolean };
  const index_no = (student.index_no || student.index || '').trim();
  const name = (student.name || '').trim();

  if (!index_no || !name) {
    return res.status(400).json({ message: 'index_no (or index) and name are required' });
  }

  try {
    const existing = await query('SELECT id FROM students WHERE index_no = ?', [index_no]) as { id: number }[];

    const programme = student.programme || null;
    const level = student.level || null;
    const photo_url = student.photo_url || student.photo || null;

    // Only apply biometric flags if explicitly provided by caller.
    // This prevents resetting face_enrolled to false when saving basic profile info.
    const hasFp = 'fingerprintEnrolled' in student || 'fingerprint_enrolled' in student;
    const hasFace = 'faceEnrolled' in student || 'face_enrolled' in student;
    const fpEnrolled = hasFp ? !!(student.fingerprintEnrolled ?? student.fingerprint_enrolled) : null;
    const faceEnrolled = hasFace ? !!(student.faceEnrolled ?? student.face_enrolled) : null;

    if (existing.length > 0) {
      // Update — only touch biometric flags if explicitly provided
      if (hasFp || hasFace) {
        await exec(
          'UPDATE students SET name = ?, programme = ?, level = ?, photo_url = ?, fingerprint_enrolled = COALESCE(?, fingerprint_enrolled), face_enrolled = COALESCE(?, face_enrolled) WHERE index_no = ?',
          [name, programme, level, photo_url, fpEnrolled, faceEnrolled, index_no]
        );
      } else {
        await exec(
          'UPDATE students SET name = ?, programme = ?, level = ?, photo_url = ? WHERE index_no = ?',
          [name, programme, level, photo_url, index_no]
        );
      }
    } else {
      await exec(
        'INSERT INTO students (index_no, name, programme, level, fingerprint_enrolled, face_enrolled, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [index_no, name, programme, level, fpEnrolled ?? false, faceEnrolled ?? false, photo_url]
      );
    }

    return res.json({ success: true, index_no, name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save student';
    console.error('[students] POST error:', message);
    res.status(500).json({ message });
  }
});

// PUT /api/students/:index — Update student (including biometric flags)
router.put('/:index', async (req, res) => {
  const index = String(req.params?.index || '').trim();
  if (!index) return res.status(400).json({ message: 'Index number is required' });

  const student = req.body as StudentRow & { photo?: string; fingerprintEnrolled?: boolean; faceEnrolled?: boolean };
  try {
    const existing = await query('SELECT id FROM students WHERE index_no = ?', [index]) as any[];
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    await exec(
      'UPDATE students SET name = ?, programme = ?, level = ?, photo_url = ?, fingerprint_enrolled = ?, face_enrolled = ? WHERE index_no = ?',
      [
        student.name || null,
        student.programme || null,
        student.level || null,
        student.photo_url || student.photo || null,
        student.fingerprintEnrolled ?? student.fingerprint_enrolled ?? false,
        student.faceEnrolled ?? student.face_enrolled ?? false,
        index,
      ]
    );

    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update student';
    res.status(500).json({ message });
  }
});

// DELETE /api/students/:index — Permanently delete a student
router.delete('/:index', async (req, res) => {
  const index = String(req.params?.index || '').trim();
  if (!index) return res.status(400).json({ message: 'Index number is required' });

  try {
    await exec('DELETE FROM students WHERE index_no = ?', [index]);
    try {
      await exec('INSERT INTO deleted_students (index_no) VALUES (?) ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP', [index]);
    } catch { /* table may not exist */ }
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete student';
    res.status(500).json({ message });
  }
});

export default router;
