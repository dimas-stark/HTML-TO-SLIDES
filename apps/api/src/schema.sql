-- Database schema for html-to-slides
-- Run once on first startup (handled by API init)

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  html_content TEXT NOT NULL,
  slide_count  INTEGER NOT NULL DEFAULT 0,
  file_size    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format       TEXT NOT NULL CHECK (format IN ('pptx', 'pdf', 'png', 'jpg', 'gif')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress     INTEGER DEFAULT 0,
  file_key     TEXT,
  filename     TEXT,
  file_size    INTEGER,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_project_id ON export_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
