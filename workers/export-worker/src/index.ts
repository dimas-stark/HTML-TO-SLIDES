import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';
import pg from 'pg';
import { HtmlSlideParser } from '@html-to-slides/html-parser';
import { PlaywrightRenderer } from '@html-to-slides/rendering-engine';
import { ExportEngine } from '@html-to-slides/export-engine';
import type { ExportJobPayload, ExportFormat } from '@html-to-slides/shared-types';

// ─────────────────────────────────────────────────────────────────
// Config from environment
// ─────────────────────────────────────────────────────────────────
const REDIS_URL   = process.env.REDIS_URL   ?? 'redis://localhost:6379';
const DB_URL      = process.env.DATABASE_URL ?? '';
const MINIO_EP    = process.env.MINIO_ENDPOINT   ?? 'localhost';
const MINIO_PORT  = parseInt(process.env.MINIO_PORT ?? '9000');
const MINIO_KEY   = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const MINIO_SEC   = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
const MINIO_BUCK  = process.env.MINIO_BUCKET     ?? 'slides-exports';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '1');

// ─────────────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const db = new pg.Pool({ connectionString: DB_URL });

const minio = new MinioClient({
  endPoint:  MINIO_EP,
  port:      MINIO_PORT,
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: MINIO_KEY,
  secretKey: MINIO_SEC,
});

// Shared renderer — one Chromium instance reused across all jobs
const renderer = new PlaywrightRenderer();

// ─────────────────────────────────────────────────────────────────
// Ensure MinIO bucket exists
// ─────────────────────────────────────────────────────────────────
async function ensureBucket(): Promise<void> {
  const exists = await minio.bucketExists(MINIO_BUCK);
  if (!exists) {
    await minio.makeBucket(MINIO_BUCK, 'us-east-1');
    console.log(`[worker] Created MinIO bucket: ${MINIO_BUCK}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Job Handler
// ─────────────────────────────────────────────────────────────────
async function processJob(job: Job<ExportJobPayload>): Promise<void> {
  const { jobId, projectId, format, htmlContent, slideCount } = job.data;

  console.log(`[worker] Starting job ${jobId} — format: ${format}, slides: ${slideCount}`);

  // Update DB status → processing
  await db.query(
    `UPDATE export_jobs SET status = 'processing', progress = 5, updated_at = NOW() WHERE id = $1`,
    [jobId]
  );

  const engine = new ExportEngine(renderer);
  const parser = new HtmlSlideParser();

  let fileBuffer: Buffer;
  let filename: string;
  let contentType: string;

  const onProgress = async (pct: number) => {
    await job.updateProgress(pct);
    await db.query(
      `UPDATE export_jobs SET progress = $1, updated_at = NOW() WHERE id = $2`,
      [pct, jobId]
    );
  };

  // ── Run the appropriate exporter ────────────────────────────────
  switch (format as ExportFormat) {
    case 'pptx':
      fileBuffer  = await engine.exportPptx(htmlContent, slideCount, onProgress);
      filename    = `slides-${projectId}.pptx`;
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      break;

    case 'pdf':
      fileBuffer  = await engine.exportPdf(htmlContent, slideCount, onProgress);
      filename    = `slides-${projectId}.pdf`;
      contentType = 'application/pdf';
      break;

    case 'png':
      fileBuffer  = await engine.exportPng(htmlContent, slideCount, onProgress);
      filename    = `slides-${projectId}-png.zip`;
      contentType = 'application/zip';
      break;

    case 'jpg':
      fileBuffer  = await engine.exportJpg(htmlContent, slideCount, onProgress);
      filename    = `slides-${projectId}-jpg.zip`;
      contentType = 'application/zip';
      break;

    case 'gif': {
      const recordDuration = job.data.options?.recordDuration ?? 5;
      fileBuffer  = await engine.exportGif(htmlContent, slideCount, { recordDuration }, onProgress);
      filename    = `slides-${projectId}-gif.zip`;
      contentType = 'application/zip';
      break;
    }

    default:
      throw new Error(`Unknown export format: ${format}`);
  }

  // ── Upload to MinIO ─────────────────────────────────────────────
  const fileKey = `${projectId}/${jobId}/${filename}`;
  await minio.putObject(MINIO_BUCK, fileKey, fileBuffer, fileBuffer.length, {
    'Content-Type': contentType,
  });
  console.log(`[worker] Uploaded to MinIO: ${fileKey}`);

  // ── Update DB → completed ────────────────────────────────────────
  await db.query(
    `UPDATE export_jobs
     SET status = 'completed', progress = 100, file_key = $1,
         filename = $2, file_size = $3, completed_at = NOW(), updated_at = NOW()
     WHERE id = $4`,
    [fileKey, filename, fileBuffer.length, jobId]
  );

  console.log(`[worker] Job ${jobId} completed — ${filename} (${fileBuffer.length} bytes)`);
}

// ─────────────────────────────────────────────────────────────────
// BullMQ Worker
// ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await renderer.launch();
  await ensureBucket();

  const worker = new Worker<ExportJobPayload>(
    'export-jobs',
    processJob,
    {
      connection: redis,
      concurrency: CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] ✓ Job ${job.id} done`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[worker] ✗ Job ${job?.id} failed:`, err.message);
    if (job?.data?.jobId) {
      await db.query(
        `UPDATE export_jobs
         SET status = 'failed', error_msg = $1, updated_at = NOW()
         WHERE id = $2`,
        [err.message.slice(0, 500), job.data.jobId]
      ).catch(() => {});
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await worker.close();
    await renderer.shutdown();
    await redis.quit();
    await db.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`[worker] Ready — concurrency: ${CONCURRENCY}`);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
