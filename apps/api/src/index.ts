import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { Client as MinioClient } from 'minio';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HtmlSlideParser } from '@html-to-slides/html-parser';
import type { ExportFormat, ExportJobPayload } from '@html-to-slides/shared-types';

// ─────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT ?? '4000');
const DB_URL    = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MINIO_EP  = process.env.MINIO_ENDPOINT ?? 'localhost';
const MINIO_PRT = parseInt(process.env.MINIO_PORT ?? '9000');
const MINIO_KEY = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const MINIO_SEC = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
const MINIO_SSL = process.env.MINIO_USE_SSL === 'true';
const BUCKET    = process.env.MINIO_BUCKET ?? 'slides-exports';

// ─────────────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────────────
const db = new pg.Pool({ connectionString: DB_URL });

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const exportQueue = new Queue<ExportJobPayload>('export-jobs', {
  connection: redis,
});

const minio = new MinioClient({
  endPoint:  MINIO_EP,
  port:      MINIO_PRT,
  useSSL:    MINIO_SSL,
  accessKey: MINIO_KEY,
  secretKey: MINIO_SEC,
});

const parser = new HtmlSlideParser();

// ─────────────────────────────────────────────────────────────────
// DB Init (run schema on startup)
// ─────────────────────────────────────────────────────────────────
async function initDb(): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await db.query(schema);
  console.log('[api] Database schema ready');
}

// ─────────────────────────────────────────────────────────────────
// Express App
// ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer for HTML file upload (store in memory, max 20MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) {
      cb(null, true);
    } else {
      cb(new Error('Only HTML files are accepted'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── POST /upload ─────────────────────────────────────────────────
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No HTML file provided' });
    }

    const html = req.file.buffer.toString('utf-8');
    const name = req.file.originalname.replace('.html', '');

    // Parse slides
    const { slideCount, externalLinks } = parser.parse(html);

    if (slideCount === 0) {
      return res.status(422).json({
        error: 'No slides detected',
        details: 'Make sure your HTML has elements with class="slide"',
      });
    }

    // Save to DB
    const id = uuidv4();
    await db.query(
      `INSERT INTO projects (id, name, html_content, slide_count, file_size)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, name, html, slideCount, req.file.size]
    );

    console.log(`[api] Uploaded project ${id} — ${slideCount} slides`);

    res.json({
      id,
      name,
      slideCount,
      fileSize: req.file.size,
      externalLinks,
    });
  } catch (err: any) {
    console.error('[api] Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /projects ─────────────────────────────────────────────────
app.get('/projects', async (_, res) => {
  const { rows } = await db.query(
    `SELECT id, name, slide_count, file_size, created_at
     FROM projects ORDER BY created_at DESC LIMIT 50`
  );
  res.json(rows);
});

// ── GET /projects/:id ─────────────────────────────────────────────
app.get('/projects/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, slide_count, file_size, created_at FROM projects WHERE id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });

  // Include recent export jobs
  const { rows: jobs } = await db.query(
    `SELECT id, format, status, progress, file_key, filename, file_size, error_msg, created_at, completed_at
     FROM export_jobs WHERE project_id = $1 ORDER BY created_at DESC`,
    [req.params.id]
  );

  res.json({ ...rows[0], exports: jobs });
});

// ── GET /projects/:id/html ─────────────────────────────────────────
// Used by the frontend iframe preview
app.get('/projects/:id/html', async (req, res) => {
  const { rows } = await db.query(
    `SELECT html_content FROM projects WHERE id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/html');
  res.send(rows[0].html_content);
});

// ── DELETE /projects/:id ──────────────────────────────────────────
app.delete('/projects/:id', async (req, res) => {
  await db.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// ── POST /projects/:id/export ─────────────────────────────────────
app.post('/projects/:id/export', async (req, res) => {
  try {
    const { format } = req.body as { format: ExportFormat };
    const validFormats: ExportFormat[] = ['pptx', 'pdf', 'png', 'jpg', 'gif'];

    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: `Invalid format. Use: ${validFormats.join(', ')}` });
    }

    // Fetch project
    const { rows } = await db.query(
      `SELECT id, name, html_content, slide_count FROM projects WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const project = rows[0];
    const jobId = uuidv4();

    // GIF-specific option: how many seconds to record per slide
    const recordDuration = (req.body as any).recordDuration ?? 5;

    // Insert job record
    await db.query(
      `INSERT INTO export_jobs (id, project_id, format, status, progress)
       VALUES ($1, $2, $3, 'pending', 0)`,
      [jobId, project.id, format]
    );

    // Enqueue
    await exportQueue.add(
      `export-${format}`,
      {
        jobId,
        projectId: project.id,
        format,
        htmlContent: project.html_content,
        slideCount: project.slide_count,
        options: { recordDuration },
      } as ExportJobPayload,
      { jobId }
    );

    console.log(`[api] Enqueued job ${jobId} — format: ${format}`);
    res.json({ jobId, status: 'pending' });
  } catch (err: any) {
    console.error('[api] Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /projects/:id/html ────────────────────────────────────────
// Saves the edited HTML back to the database (used by the text editor)
app.put('/projects/:id/html', async (req, res) => {
  try {
    const { htmlContent } = req.body as { htmlContent: string };

    if (!htmlContent || typeof htmlContent !== 'string') {
      return res.status(400).json({ error: 'htmlContent is required' });
    }

    // Sanity check: must still have slides
    if (!htmlContent.includes('class="slide"') && !htmlContent.includes("class='slide'")) {
      return res.status(422).json({ error: 'Edited HTML must still contain slide elements' });
    }

    const { rowCount } = await db.query(
      `UPDATE projects SET html_content = $1, updated_at = NOW() WHERE id = $2`,
      [htmlContent, req.params.id]
    );

    if (rowCount === 0) return res.status(404).json({ error: 'Project not found' });

    console.log(`[api] HTML updated for project ${req.params.id}`);
    res.json({ updated: true });
  } catch (err: any) {
    console.error('[api] Update HTML error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /jobs/:id ─────────────────────────────────────────────────
app.get('/jobs/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, project_id, format, status, progress, file_key, filename, file_size, error_msg, created_at, completed_at
     FROM export_jobs WHERE id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Job not found' });
  res.json(rows[0]);
});

// ── GET /download/:jobId ──────────────────────────────────────────
// Proxy download from MinIO → client
app.get('/download/:jobId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT file_key, filename, status FROM export_jobs WHERE id = $1`,
      [req.params.jobId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const job = rows[0];
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Export not completed yet' });
    }

    const stream = await minio.getObject(BUCKET, job.file_key);
    res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);
  } catch (err: any) {
    console.error('[api] Download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await initDb();

  app.listen(PORT, () => {
    console.log(`[api] Server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[api] Fatal:', err);
  process.exit(1);
});
