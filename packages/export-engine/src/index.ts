import PptxGenJS from 'pptxgenjs';
import archiver from 'archiver';
import { Readable } from 'stream';
import { readFile, unlink } from 'fs/promises';
import type { PlaywrightRenderer } from '@html-to-slides/rendering-engine';

// ─────────────────────────────────────────────────────────────────
// ExportEngine — Image-Based Export
//
// All screenshot-based exports (PPTX, PNG, JPG) use captureAllSlides()
// which loads the HTML ONCE and screenshots each slide in sequence.
// This avoids repeated CDN requests and the "stuck on slide N" issue.
// ─────────────────────────────────────────────────────────────────

export class ExportEngine {
  constructor(private renderer: PlaywrightRenderer) {}

  // ── PPTX Export ────────────────────────────────────────────────
  async exportPptx(
    html: string,
    slideCount: number,
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch

    onProgress?.(5);

    // Capture all slides in ONE Playwright page load
    const images = await this.renderer.captureAllSlides(html, slideCount, {
      format: 'png',
      highDpi: true,
    }, (current, total) => {
      onProgress?.(5 + Math.round((current / total) * 75));
    });

    onProgress?.(82);

    for (let i = 0; i < images.length; i++) {
      console.log(`[export] PPT slide ${i + 1}/${images.length}`);
      const imgBase64 = images[i].toString('base64');
      const slide = pptx.addSlide();
      slide.addImage({
        data: `image/png;base64,${imgBase64}`,
        x: 0, y: 0, w: '100%', h: '100%',
      });
    }

    onProgress?.(92);
    const buf = await pptx.write({ outputType: 'nodebuffer' });
    return buf as Buffer;
  }

  // ── PDF Export ─────────────────────────────────────────────────
  async exportPdf(
    html: string,
    slideCount: number,
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    onProgress?.(10);
    const pdfBuf = await this.renderer.capturePdf(html, slideCount);
    onProgress?.(95);
    return pdfBuf;
  }

  // ── PNG Export (ZIP of individual slides) ─────────────────────
  async exportPng(
    html: string,
    slideCount: number,
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    return this.exportImages(html, slideCount, 'png', onProgress);
  }

  // ── JPG Export (ZIP of individual slides) ─────────────────────
  async exportJpg(
    html: string,
    slideCount: number,
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    return this.exportImages(html, slideCount, 'jpeg', onProgress);
  }

  // ── GIF Export (Option A: one animated GIF per slide → ZIP) ───
  async exportGif(
    html: string,
    slideCount: number,
    options: { recordDuration?: number } = {},
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    onProgress?.(5);
    const recordDuration = options.recordDuration ?? 5;
    const gifPaths: string[] = [];

    for (let i = 0; i < slideCount; i++) {
      console.log(`[export] GIF recording slide ${i + 1}/${slideCount} (${recordDuration}s animation)`);
      const gifPath = await this.renderer.recordSlideGif(html, i, { recordDuration });
      gifPaths.push(gifPath);
      onProgress?.(5 + Math.round(((i + 1) / slideCount) * 88));
    }

    const gifBuffers = await Promise.all(gifPaths.map(p => readFile(p)));

    const zipBuf = await this.packZip(
      gifBuffers.map((buf, i) => ({
        name: `slide-${String(i + 1).padStart(2, '0')}.gif`,
        data: buf,
      }))
    );

    await Promise.all(gifPaths.map(p => unlink(p).catch(() => {})));

    onProgress?.(98);
    return zipBuf;
  }

  // ── Internal: ZIP all slide images ────────────────────────────
  private async exportImages(
    html: string,
    slideCount: number,
    format: 'png' | 'jpeg',
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    onProgress?.(5);

    // Capture all slides in ONE Playwright page load
    const imageBuffers = await this.renderer.captureAllSlides(html, slideCount, {
      format,
      highDpi: true,
    }, (current, total) => {
      onProgress?.(5 + Math.round((current / total) * 85));
    });

    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const zipBuf = await this.packZip(
      imageBuffers.map((buf, i) => ({
        name: `slide-${String(i + 1).padStart(2, '0')}.${ext}`,
        data: buf,
      }))
    );

    onProgress?.(98);
    return zipBuf;
  }

  // ── ZIP helper ─────────────────────────────────────────────────
  private packZip(
    files: { name: string; data: Buffer }[]
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 6 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      for (const file of files) {
        archive.append(Readable.from(file.data), { name: file.name });
      }

      archive.finalize();
    });
  }
}
