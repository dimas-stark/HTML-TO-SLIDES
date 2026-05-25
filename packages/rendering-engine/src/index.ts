import { chromium, Browser, BrowserContext } from 'playwright';

// ─────────────────────────────────────────────────────────────────
// PlaywrightRenderer
// Headless Chromium wrapper for slide screenshot + PDF capture
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

  // ── Setup page: block external CDN requests ───────────────────
  // Presentations use Tailwind CDN, FontAwesome, Google Fonts etc.
  // These external requests cause `networkidle` to timeout inside Docker.
  // We block them and use domcontentloaded + a short settle delay instead.
  private async setupPage(ctx: BrowserContext, html: string): Promise<ReturnType<BrowserContext['newPage']>> {
    const page = await ctx.newPage();

    await page.route('**/*', (route) => {
      const url = route.request().url();
      // Allow data URIs and blob (inline images, etc.)
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
      }
      // Block external HTTPS requests (CDNs, analytics, fonts, etc.)
      if (url.startsWith('https://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        return route.abort();
      }
      return route.continue();
    });

    // Use domcontentloaded — doesn't wait for external CDN resources
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Give inline Tailwind JIT + slide JS time to process
    await page.waitForTimeout(1500);

    return page;
  }

  // ── Screenshot single slide ────────────────────────────────────
  async captureSlide(
    html: string,
    slideIndex: number,
    options: CaptureOptions = {}
  ): Promise<Buffer> {
    this.assertReady();
    const ctx = await this.newContext(options.highDpi ?? true);
    const page = await this.setupPage(ctx, html);

    try {
      // Activate only the target slide, hide nav controls, reset transform
      await page.evaluate((idx: number) => {
        const slides = document.querySelectorAll<HTMLElement>('.slide');
        slides.forEach((slide, i) => {
          slide.style.cssText = `
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important; height: 100% !important;
            opacity: ${i === idx ? '1' : '0'} !important;
            visibility: ${i === idx ? 'visible' : 'hidden'} !important;
            transform: scale(1) !important;
            z-index: ${i === idx ? '10' : '0'} !important;
          `;
          if (i === idx) {
            slide.classList.add('active');
          } else {
            slide.classList.remove('active');
          }
        });

        const controls = document.getElementById('controls');
        if (controls) controls.style.display = 'none';

        const deck = document.getElementById('deck-container');
        if (deck) {
          deck.style.transform = 'none';
          deck.style.width = '1280px';
          deck.style.height = '720px';
        }
      }, slideIndex);

      // Wait for fonts to load (local fallbacks only, since CDN is blocked)
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      // Capture exactly the deck container
      const deckEl = await page.$('#deck-container');
      if (deckEl) {
        return await deckEl.screenshot({
          type: options.format ?? 'png',
          quality: options.format === 'jpeg' ? (options.quality ?? 90) : undefined,
        }) as Buffer;
      }

      // Fallback: viewport screenshot
      return await page.screenshot({
        type: options.format ?? 'png',
        clip: { x: 0, y: 0, width: 1280, height: 720 },
      }) as Buffer;
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  // ── Capture all slides as PNG buffers ──────────────────────────
  async captureAllSlides(
    html: string,
    slideCount: number,
    options: CaptureOptions = {}
  ): Promise<Buffer[]> {
    const results: Buffer[] = [];
    for (let i = 0; i < slideCount; i++) {
      console.log(`[renderer] Capturing slide ${i + 1}/${slideCount}`);
      const buf = await this.captureSlide(html, i, options);
      results.push(buf);
    }
    return results;
  }

  // ── PDF export (all slides as print pages) ─────────────────────
  async capturePdf(html: string, slideCount: number): Promise<Buffer> {
    this.assertReady();
    const ctx = await this.newContext(false); // PDF doesn't need HiDPI
    const page = await this.setupPage(ctx, html);

    try {
      // Inject print CSS: show all slides as separate pages
      await page.addStyleTag({
        content: `
          body {
            background: white !important;
            overflow: visible !important;
            display: block !important;
            margin: 0 !important;
          }
          #deck-container {
            transform: none !important;
            box-shadow: none !important;
            width: 1280px !important;
            height: auto !important;
            overflow: visible !important;
            position: static !important;
          }
          #controls { display: none !important; }
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
