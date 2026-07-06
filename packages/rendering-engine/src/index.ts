import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { convertWebmToGif } from './gif-converter';

// ─────────────────────────────────────────────────────────────────
// PlaywrightRenderer
// Headless Chromium wrapper for slide screenshot + PDF + GIF capture
// Optimized for LXC environments (no sandbox, shared /dev/shm)
// ─────────────────────────────────────────────────────────────────

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',     // use /tmp instead of /dev/shm
  '--disable-gpu',
  '--font-render-hinting=none',  // consistent font rendering
  '--disable-lcd-text',
  '--force-device-scale-factor=2', // HiDPI for crisp output
];

// How long to wait after 'load' for any CDN (Tailwind, Google Fonts, etc.) to settle.
// This wait happens only ONCE per export batch, not per slide.
const CDN_SETTLE_MS = 5000;

export class PlaywrightRenderer {
  private browser: Browser | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────
  async launch(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
    });
    console.log('[renderer] Chromium launched');
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[renderer] Chromium shut down');
    }
  }

  // ── Setup page: load HTML + wait for external CDN ─────────────
  // waitUntil: 'load' fires after scripts download (Tailwind, Google Fonts CDN, etc.).
  // We then add CDN_SETTLE_MS to let any CSS injection / font rendering complete.
  private async setupPage(ctx: BrowserContext, html: string): Promise<Page> {
    const page = await ctx.newPage();
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // Give CDN resources time to apply (Tailwind JIT, Google Fonts, etc.)
    await page.waitForTimeout(CDN_SETTLE_MS);
    return page;
  }

  // ── Activate a specific slide on a page ───────────────────────
  // Overrides inline styles to force the target slide visible,
  // hides all navigation UI, and marks the deck container.
  private async activateSlide(page: Page, slideIndex: number): Promise<void> {
    await page.evaluate((idx: number) => {
      const slides = document.querySelectorAll<HTMLElement>('.slide');
      let deckElement: HTMLElement | null = null;
      slides.forEach((slide, i) => {
        slide.style.cssText = `
          position: absolute !important;
          top: 0 !important; left: 0 !important;
          width: 100% !important; height: 100% !important;
          opacity: ${i === idx ? '1' : '0'} !important;
          visibility: ${i === idx ? 'visible' : 'hidden'} !important;
          transform: scale(1) !important;
          z-index: ${i === idx ? '10' : '0'} !important;
          transition: none !important;
        `;
        if (i === idx) {
          slide.classList.add('active');
          if (slide.parentElement) deckElement = slide.parentElement;
        } else {
          slide.classList.remove('active');
        }
      });

      // Hide all common navigation UI elements
      ['controls', 'nav', 'progress-bar', 'slide-counter', 'dots'].forEach(id => {
        const el = document.getElementById(id) || document.querySelector(`.${id}`);
        if (el) (el as HTMLElement).style.display = 'none';
      });

      // Neutralize the HTML's own JS navigation
      (window as any).goToSlide = () => {};
      (window as any).nextSlide = () => {};
      (window as any).prevSlide = () => {};

      if (deckElement) {
        deckElement.classList.add('export-deck-container');
        deckElement.style.transform = 'none';
        deckElement.style.width = '1280px';
        deckElement.style.height = '720px';
        deckElement.style.overflow = 'hidden';
      }
    }, slideIndex);
  }

  // ── Capture ALL slides in a SINGLE page load ──────────────────
  // KEY OPTIMIZATION: HTML is loaded ONCE, then we switch slides.
  // This avoids:
  //  - N separate CDN requests (Google Fonts, Tailwind, etc.)
  //  - Resource leaks from repeated page creation/destruction
  //  - The "stuck on slide N" issue caused by CDN rate-limiting
  async captureAllSlides(
    html: string,
    slideCount: number,
    options: CaptureOptions = {},
    onProgress?: (current: number, total: number) => void
  ): Promise<Buffer[]> {
    this.assertReady();
    const ctx = await this.newContext(options.highDpi ?? true);
    const page = await this.setupPage(ctx, html);
    const results: Buffer[] = [];

    try {
      for (let i = 0; i < slideCount; i++) {
        console.log(`[renderer] Capturing slide ${i + 1}/${slideCount}`);
        await this.activateSlide(page, i);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200); // small settle for CSS transitions

        // Screenshot the active slide element directly
        const slideEl = await page.$('.slide.active');
        let buf: Buffer;
        if (slideEl) {
          buf = await slideEl.screenshot({
            type: options.format ?? 'png',
            quality: options.format === 'jpeg' ? (options.quality ?? 90) : undefined,
          }) as Buffer;
        } else {
          // Fallback: viewport clip
          buf = await page.screenshot({
            type: options.format ?? 'png',
            clip: { x: 0, y: 0, width: 1280, height: 720 },
          }) as Buffer;
        }

        results.push(buf);
        onProgress?.(i + 1, slideCount);
      }
    } finally {
      await page.close();
      await ctx.close();
    }

    return results;
  }

  // ── Screenshot single slide (kept for one-off use) ────────────
  async captureSlide(
    html: string,
    slideIndex: number,
    options: CaptureOptions = {}
  ): Promise<Buffer> {
    this.assertReady();
    const ctx = await this.newContext(options.highDpi ?? true);
    const page = await this.setupPage(ctx, html);

    try {
      await this.activateSlide(page, slideIndex);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      // Screenshot the active slide element directly
      const slideEl = await page.$('.slide.active');
      if (slideEl) {
        return await slideEl.screenshot({
          type: options.format ?? 'png',
          quality: options.format === 'jpeg' ? (options.quality ?? 90) : undefined,
        }) as Buffer;
      }

      // Fallback 1: export-deck-container
      const deckEl = await page.$('.export-deck-container');
      if (deckEl) {
        return await deckEl.screenshot({
          type: options.format ?? 'png',
          quality: options.format === 'jpeg' ? (options.quality ?? 90) : undefined,
        }) as Buffer;
      }

      // Fallback 2: viewport clip
      return await page.screenshot({
        type: options.format ?? 'png',
        clip: { x: 0, y: 0, width: 1280, height: 720 },
      }) as Buffer;
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  // ── PDF export (all slides as print pages) ─────────────────────
  async capturePdf(html: string, slideCount: number): Promise<Buffer> {
    this.assertReady();
    const ctx = await this.newContext(false);
    const page = await this.setupPage(ctx, html);

    try {
      await page.evaluate(() => {
        const slides = document.querySelectorAll<HTMLElement>('.slide');
        if (slides.length > 0 && slides[0].parentElement) {
          slides[0].parentElement.classList.add('export-deck-container');
        }
        ['controls', 'nav', 'progress-bar', 'slide-counter', 'dots'].forEach(id => {
          const el = document.getElementById(id) || document.querySelector(`.${id}`);
          if (el) (el as HTMLElement).style.display = 'none';
        });
        (window as any).goToSlide = () => {};
      });

      await page.addStyleTag({
        content: `
          body {
            background: white !important;
            overflow: visible !important;
            display: block !important;
            margin: 0 !important;
          }
          .export-deck-container {
            transform: none !important;
            box-shadow: none !important;
            width: 1280px !important;
            height: auto !important;
            overflow: visible !important;
            position: static !important;
          }
          .slide {
            position: relative !important;
            display: block !important;
            opacity: 1 !important;
            visibility: visible !important;
            transform: none !important;
            width: 1280px !important;
            height: 720px !important;
            page-break-after: always !important;
            overflow: hidden !important;
            transition: none !important;
          }
          @page { size: 1280px 720px; margin: 0; }
        `,
      });

      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      const pdfBuffer = await page.pdf({
        width: '1280px',
        height: '720px',
        printBackground: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  // ── Record a slide's CSS animation to GIF ─────────────────────
  // Uses Playwright's built-in video recording (outputs WebM),
  // then converts to GIF using ffmpeg (see gif-converter.ts).
  //
  // The recording flow:
  //   T=0..5s: CDN loads + processes (will be trimmed from GIF)
  //   T=5s:    slide activates → CSS animations BEGIN
  //   T=5..5+recordDuration: animations play (this is the GIF content)
  //   T=5+recordDuration: page closes → video is finalized
  async recordSlideGif(
    html: string,
    slideIndex: number,
    options: GifCaptureOptions = {}
  ): Promise<string> {
    this.assertReady();
    const recordDuration = options.recordDuration ?? 5;
    const cdnWaitSec = CDN_SETTLE_MS / 1000;

    const tmpDir = join(tmpdir(), `gif-slide-${slideIndex}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    const ctx = await this.browser!.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: tmpDir,
        size: { width: 1280, height: 720 },
      },
    });

    const page = await ctx.newPage();

    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(CDN_SETTLE_MS);

      // Activate slide → CSS animations start NOW
      await this.activateSlide(page, slideIndex);
      await page.evaluate(() => document.fonts.ready);

      // Record the animation playing
      await page.waitForTimeout(recordDuration * 1000);

    } finally {
      const video = page.video();
      await page.close();
      await ctx.close();

      const webmPath = await video!.path();
      const gifPath = webmPath.replace(/\.webm$/, '.gif');

      console.log(`[renderer] Converting WebM → GIF (skip ${cdnWaitSec}s CDN loading phase)`);
      await convertWebmToGif(webmPath, gifPath, cdnWaitSec);

      return gifPath;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  private async newContext(highDpi: boolean): Promise<BrowserContext> {
    return this.browser!.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: highDpi ? 2 : 1,
    });
  }

  private assertReady(): void {
    if (!this.browser) {
      throw new Error('[renderer] Browser not launched — call launch() first');
    }
  }
}

export interface CaptureOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  highDpi?: boolean;
}

export interface GifCaptureOptions {
  // How many seconds to record the slide animation (default: 5)
  recordDuration?: number;
}
