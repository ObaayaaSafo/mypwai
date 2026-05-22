-- 004_deleted_students.sql
-- Track permanently deleted student index numbers to prevent re-imports

CREATE TABLE IF NOT EXISTS deleted_students (
  index_no VARCHAR(255) PRIMARY KEY,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
