-- Add session_id to attendance and scan_events for precise per-session cascade
-- This replaces the old course_code+date matching which affected other sessions on the same day.

ALTER TABLE attendance
  ADD COLUMN session_id INT NULL AFTER course_code,
  ADD INDEX idx_attendance_session (session_id),
  ADD CONSTRAINT fk_attendance_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE scan_events
  ADD COLUMN session_id INT NULL AFTER course_code,
  ADD INDEX idx_scan_events_session (session_id),
  ADD CONSTRAINT fk_scan_events_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
