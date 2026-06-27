-- Create session_locks table for concurrency control
CREATE TABLE IF NOT EXISTS session_locks (
  session_id INT PRIMARY KEY,
  locked_by VARCHAR(255) NOT NULL,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
