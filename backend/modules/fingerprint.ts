// Index: ensureReady():15 | ensureTable():51 | loadTemplatesFromDB():68 | GET /status:86 | POST /init:98
//        POST /shutdown:107 | POST /capture:118 | POST /enroll:133 | POST /verify:192 | POST /reload:238
//        DELETE /template/:studentId:249 | GET /enrolled:268
import express from 'express';
import { query } from '../db.js';
import {
  zkInit, zkTerminate, zkGetDeviceCount, zkOpenDevice, zkCloseDevice,
  zkInitDB, zkCapture, zkIdentify, zkLoadTemplates, zkAddTemplate,
  zkClearDB, zkGetCount, zkRemoveTemplate,
  isDeviceOpen, isDBReady,
} from './zkbridge.js';

const router = express.Router();

// ── Lifecycle ──
let systemReady = false;
let initPromise: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (systemReady) return;
  // Prevent concurrent initializations (race condition on hDBCache)
  if (initPromise) return initPromise;
  initPromise = (async () => {

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
  })();
  return initPromise;
}

async function ensureTable(): Promise<void> {
  // Create table if not exists (new schema: multi-template, no UNIQUE on student_id)
  await query(`
    CREATE TABLE IF NOT EXISTS fingerprints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fid INT NOT NULL,
      student_id VARCHAR(50) NOT NULL,
      template_base64 LONGTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_fp_fid (fid),
      INDEX idx_fp_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrate old table: drop UNIQUE on student_id if it exists
  try { await query('ALTER TABLE fingerprints DROP INDEX student_id'); } catch {}
  try { await query('ALTER TABLE fingerprints DROP INDEX idx_fp_student_old'); } catch {}

  // Add fid column if missing (old schema didn't have it)
  try {
    await query(`ALTER TABLE fingerprints ADD COLUMN fid INT NOT NULL DEFAULT 0 AFTER id`);
    await query('UPDATE fingerprints SET fid = id WHERE fid = 0');
  } catch {}
}

async function nextFid(): Promise<number> {
  const rows = await query('SELECT COALESCE(MAX(fid), 0) + 1 AS next FROM fingerprints') as any[];
  return (rows[0] as any)?.next ?? 1;
}

async function loadTemplatesFromDB(): Promise<void> {
  try {
    await ensureTable();
    const rows = await query('SELECT fid, template_base64 FROM fingerprints ORDER BY fid') as any[];
    const templates = rows.map((r: any) => ({ id: r.fid, template: r.template_base64 }));
    const loaded = zkLoadTemplates(templates);
    console.log(`[Fingerprint] Loaded ${loaded}/${templates.length} templates from DB`);
  } catch (err) {
    console.log('[Fingerprint] No fingerprints table or DB unavailable — skipping template load');
  }
}

// ── Status ──
router.get('/status', async (req, res) => {
  try {
    if (!systemReady) return res.json({ ready: false, message: 'System not initialized' });
    res.json({ ready: true, deviceOpen: isDeviceOpen(), templateCount: zkGetCount() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/init', async (req, res) => {
  try {
    await ensureReady();
    res.json({ success: true, deviceCount: zkGetDeviceCount(), templateCount: zkGetCount() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/shutdown', async (req, res) => {
  try {
    zkTerminate(); systemReady = false;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Capture (polls scanner up to 15s) ──
router.post('/capture', async (req, res) => {
  try {
    await ensureReady();
    if (!systemReady) return res.status(503).json({ error: 'Scanner not initialized' });
    const result = await zkCapture();
    if (!result) return res.status(400).json({ error: 'No finger detected (15s timeout)' });
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Enroll (accepts pre-captured template OR captures fresh; supports multi-template) ──
router.post('/enroll', async (req, res) => {
  try {
    await ensureReady();
    const { studentId, templateBase64 } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });

    let captureResult: { templateBase64: string } | null = null;
    if (templateBase64) {
      captureResult = { templateBase64 };
    } else {
      captureResult = await zkCapture();
      if (!captureResult) return res.status(400).json({ error: 'Capture timeout (15s)' });
    }

    await ensureTable();
    const fid = await nextFid();

    await query('INSERT INTO fingerprints (fid, student_id, template_base64) VALUES (?, ?, ?)',
      [fid, studentId, captureResult.templateBase64]);

    const added = zkAddTemplate(fid, captureResult.templateBase64);
    console.log(`[Fingerprint] Enroll ${studentId}: fid=${fid}, added=${added}, total=${zkGetCount()}`);

    await query('UPDATE students SET fingerprint_enrolled = TRUE WHERE index_no = ?', [studentId]);

    res.json({ success: true, message: 'Fingerprint enrolled successfully', templateCount: zkGetCount(), fid });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Verify (accepts pre-captured template OR scans fresh; 1:N identification) ──
router.post('/verify', async (req, res) => {
  try {
    await ensureReady();
    const { templateBase64 } = req.body;

    let captureResult: { templateBase64: string } | null = null;
    if (templateBase64) {
      captureResult = { templateBase64 };
    } else {
      captureResult = await zkCapture();
      if (!captureResult) return res.status(400).json({ error: 'Capture timeout (15s)' });
    }

    const match = zkIdentify(captureResult.templateBase64);
    if (!match) return res.json({ matched: false, message: 'Fingerprint not recognized' });

    const rows = await query(
      'SELECT s.index_no, s.name, s.programme, s.level FROM fingerprints f JOIN students s ON s.index_no = f.student_id WHERE f.fid = ?',
      [match.fid]) as any[];

    if (rows.length === 0) return res.json({ matched: false, message: 'No student record', fid: match.fid, score: match.score });

    const student = rows[0];
    res.json({ matched: true, student: { index: student.index_no, name: student.name, programme: student.programme, level: student.level }, score: match.score, fid: match.fid });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Reload templates from DB ──
router.post('/reload', async (req, res) => {
  try {
    zkClearDB(); await loadTemplatesFromDB();
    res.json({ success: true, templateCount: zkGetCount() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Delete all templates for a student ──
router.delete('/template/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await query('SELECT fid FROM fingerprints WHERE student_id = ?', [studentId]) as any[];
    for (const r of rows) zkRemoveTemplate((r as any).fid);
    await query('DELETE FROM fingerprints WHERE student_id = ?', [studentId]);
    const remaining = await query('SELECT COUNT(*) AS cnt FROM fingerprints WHERE student_id = ?', [studentId]) as any[];
    if (((remaining[0] as any)?.cnt ?? 0) === 0)
      await query('UPDATE students SET fingerprint_enrolled = FALSE WHERE index_no = ?', [studentId]);
    res.json({ success: true, removed: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Get enrolled students ──
router.get('/enrolled', async (req, res) => {
  try {
    const rows = await query('SELECT s.index_no, s.name, COUNT(f.id) AS template_count FROM students s JOIN fingerprints f ON f.student_id = s.index_no GROUP BY s.index_no, s.name');
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Debug: compare MySQL rows vs SDK runtime ──
router.get('/debug', async (req, res) => {
  try {
    const mysqlRows = await query('SELECT fid, student_id, LENGTH(template_base64) AS tpl_len FROM fingerprints ORDER BY fid') as any[];
    res.json({ systemReady, sdkTemplateCount: zkGetCount(), mysqlRows, mismatch: mysqlRows.length !== zkGetCount() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
