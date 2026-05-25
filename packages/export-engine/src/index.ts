import PptxGenJS from 'pptxgenjs';
import archiver from 'archiver';
import { Readable } from 'stream';
import type { PlaywrightRenderer } from '@html-to-slides/rendering-engine';

// ─────────────────────────────────────────────────────────────────
// ExportEngine — Phase 1 (Image-Based)
// All formats use Playwright screenshot as the source of truth.
// Phase 2 will add native PPT element rendering.
// ─────────────────────────────────────────────────────────────────

export class ExportEngine {
  constructor(private renderer: PlaywrightRenderer) {}

  // ── PPTX Export (Phase 1: each slide = 1 image) ────────────────
  async exportPptx(
    html: string,
    slideCount: number,
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch

    onProgress?.(10);

    for (let i = 0; i < slideCount; i++) {
      console.log(`[export] PPT slide ${i + 1}/${slideCount}`);

      // Capture screenshot
      const imgBuf = await this.renderer.captureSlide(html, i, {
        format: 'png',
        highDpi: true,
      });
      const imgBase64 = imgBuf.toString('base64');

      // Add to PPT as full-slide image
      const slide = pptx.addSlide();
      slide.addImage({
        data: `image/png;base64,${imgBase64}`,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
      });

      onProgress?.(10 + Math.round(((i + 1) / slideCount) * 75));
    }

    onProgress?.(90);

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

  // ── Internal: ZIP all slide images ────────────────────────────
  private async exportImages(
    html: string,
    slideCount: number,
    format: 'png' | 'jpeg',
    onProgress?: (pct: number) => void
  ): Promise<Buffer> {
    onProgress?.(5);

    const imageBuffers: Buffer[] = [];
    for (let i = 0; i < slideCount; i++) {
      console.log(`[export] Image slide ${i + 1}/${slideCount}`);
      const buf = await this.renderer.captureSlide(html, i, { format, highDpi: true });
      imageBuffers.push(buf);
      onProgress?.(5 + Math.round(((i + 1) / slideCount) * 80));
    }

    // Pack into ZIP
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

export type { ExportEngine };
