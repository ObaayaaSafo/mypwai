-- Create fingerprints table for storing fingerprint templates.
-- Supports multiple templates per student (e.g., multiple fingers or multiple scans).
CREATE TABLE IF NOT EXISTS fingerprints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fid INT NOT NULL,                    -- ZK SDK internal FID (unique in runtime DB)
  student_id VARCHAR(50) NOT NULL,     -- student index_no
  template_base64 LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fp_fid (fid),
  INDEX idx_fp_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
