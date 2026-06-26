// Index: ensureReady():15 | ensureTable():49 | loadTemplatesFromDB():62 | GET /status:80 | POST /init:92
//        POST /shutdown:101 | POST /capture:112 | POST /enroll:127 | POST /verify:168 | POST /reload:210
//        DELETE /template/:studentId:221 | GET /enrolled:240
import express from 'express';
import { query } from '../db.js';
import {
  zkInit, zkTerminate, zkGetDeviceCount, zkOpenDevice, zkCloseDevice,
  zkInitDB, zkCapture, zkIdentify, zkLoadTemplates, zkAddTemplate,
  zkClearDB, zkGetCount, zkRemoveTemplate, zkInitDB as initDB,
  isDeviceOpen, isDBReady,
} from './zkbridge.js';

const router = express.Router();

// ── Lifecycle ──
let systemReady = false;

async function ensureReady(): Promise<void> {
  if (systemReady) return;

  console.log('[Fingerprint] Initializing ZKFinger SDK...');
  const ret = zkInit();
  if (ret !== 0) throw new Error(`ZKFPM_Init failed: ${ret}`);

  const count = zkGetDeviceCount();
  console.log(`[Fingerprint] Devices found: ${count}`);
  if (count === 0) {
    console.log('[Fingerprint] No device detected — scanner may be unplugged');
    return;
  }

  const opened = zkOpenDevice(0);
  if (!opened) {
    console.log('[Fingerprint] Failed to open device');
    return;
  }

  console.log('[Fingerprint] Device opened, initializing algorithm engine...');
  const dbOk = zkInitDB();
  if (!dbOk) {
    console.log('[Fingerprint] Failed to initialize fingerprint algorithm engine');
    return;
  }

  // Load stored templates from DB
  await loadTemplatesFromDB();

  systemReady = true;
  console.log(`[Fingerprint] System ready — ${zkGetCount()} templates loaded`);
}

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS fingerprints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id VARCHAR(50) NOT NULL UNIQUE,
      template_base64 LONGTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_fp_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function loadTemplatesFromDB(): Promise<void> {
  try {
    await ensureTable();
    const rows = await query(
      'SELECT id, template_base64 FROM fingerprints'
    ) as any[];
    const templates = rows.map((r: any) => ({
      id: r.id,
      template: r.template_base64,
    }));
    const loaded = zkLoadTemplates(templates);
    console.log(`[Fingerprint] Loaded ${loaded}/${templates.length} templates from DB`);
  } catch (err) {
    console.log('[Fingerprint] No fingerprints table or DB unavailable — skipping template load');
  }
}

// ── Status ──
router.get('/status', async (req, res) => {
  try {
    if (!systemReady) {
      return res.json({ ready: false, message: 'System not initialized' });
    }
    const count = zkGetCount();
    res.json({ ready: true, deviceOpen: isDeviceOpen(), templateCount: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/init', async (req, res) => {
  try {
    await ensureReady();
    res.json({ success: true, deviceCount: zkGetDeviceCount(), templateCount: zkGetCount() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/shutdown', async (req, res) => {
  try {
    zkTerminate();
    systemReady = false;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Capture (polls scanner up to 15s — have user place finger before calling) ──
router.post('/capture', async (req, res) => {
  try {
    await ensureReady();
    if (!systemReady) return res.status(503).json({ error: 'Scanner not initialized. Is the device plugged in?' });
    const result = await zkCapture();
    if (!result) {
      return res.status(400).json({ error: 'No finger detected (15s timeout). Place your finger flat on the sensor and try again.' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Enroll ──
router.post('/enroll', async (req, res) => {
  try {
    await ensureReady();

    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });

    // Capture fingerprint
    const result = await zkCapture();
    if (!result) {
      return res.status(400).json({ error: 'Failed to capture fingerprint (15s timeout). Place finger on scanner and try again.' });
    }

    // Store in DB
    await query(
      'INSERT INTO fingerprints (student_id, template_base64) VALUES (?, ?) ON DUPLICATE KEY UPDATE template_base64 = VALUES(template_base64)',
      [studentId, result.templateBase64]
    );

    // Add to runtime cache
    const student = await query('SELECT id FROM students WHERE index_no = ?', [studentId]) as any[];
    const fid = student.length > 0 ? student[0].id : parseInt(studentId.replace(/\D/g, '')) || Date.now();
    zkAddTemplate(fid, result.templateBase64);

    // Update student enrollment status
    await query(
      'UPDATE students SET fingerprint_enrolled = TRUE WHERE index_no = ?',
      [studentId]
    );

    res.json({
      success: true,
      message: 'Fingerprint enrolled successfully',
      templateCount: zkGetCount(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Verify (scan → identify → match attendance) ──
router.post('/verify', async (req, res) => {
  try {
    await ensureReady();

    const capture = await zkCapture();
    if (!capture) {
      return res.status(400).json({ error: 'Failed to capture fingerprint (15s timeout). Place finger on scanner.' });
    }

    // 1:N identification against all enrolled templates
    const match = zkIdentify(capture.templateBase64);
    if (!match) {
      return res.json({ matched: false, message: 'Fingerprint not recognized' });
    }

    // Look up student by the matched fid
    const rows = await query(
      'SELECT s.index_no, s.name, s.programme, s.level FROM students s JOIN fingerprints f ON f.student_id = s.index_no WHERE s.id = ?',
      [match.fid]
    ) as any[];

    if (rows.length === 0) {
      return res.json({ matched: false, message: 'Fingerprint matched but no student record found', fid: match.fid, score: match.score });
    }

    const student = rows[0];
    res.json({
      matched: true,
      student: {
        index: student.index_no,
        name: student.name,
        programme: student.programme,
        level: student.level,
      },
      score: match.score,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reload templates from DB ──
router.post('/reload', async (req, res) => {
  try {
    zkClearDB();
    await loadTemplatesFromDB();
    res.json({ success: true, templateCount: zkGetCount() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete template ──
router.delete('/template/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await query('SELECT id FROM students WHERE index_no = ?', [studentId]) as any[];

    if (student.length > 0) {
      zkRemoveTemplate(student[0].id);
    }

    await query('DELETE FROM fingerprints WHERE student_id = ?', [studentId]);
    await query('UPDATE students SET fingerprint_enrolled = FALSE WHERE index_no = ?', [studentId]);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get enrolled students ──
router.get('/enrolled', async (req, res) => {
  try {
    const rows = await query(
      'SELECT s.index_no, s.name FROM students s JOIN fingerprints f ON f.student_id = s.index_no'
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
