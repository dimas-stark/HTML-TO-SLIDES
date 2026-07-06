import { JSDOM } from 'jsdom';
import type { SlideData, BackgroundStyle } from '@html-to-slides/shared-types';

// ─────────────────────────────────────────────────────────────────
// HtmlSlideParser
// Parses an HTML string, detects .slide elements, extracts metadata
// Works server-side via JSDOM (no real browser needed)
// ─────────────────────────────────────────────────────────────────

export class HtmlSlideParser {
  parse(html: string): ParseResult {
    // Note: we do NOT run scripts — we only need DOM structure and
    // inline styles/class names for slide detection
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const slideEls = this.detectSlides(document);
    const slideCount = slideEls.length;

    const slides: SlideData[] = slideEls.map((el, index) => {
      return this.parseSlide(el, index);
    });

    // Extract external dependencies from <head> so Playwright can
    // load them properly when doing screenshots
    const externalLinks = this.extractExternalLinks(document);

    return { slides, slideCount, externalLinks };
  }

  // ── Slide Detection ─────────────────────────────────────────────
  private detectSlides(document: Document): Element[] {
    // Priority order — first match wins
    const selectors = [
      '#deck-container > .slide',  // matches sample.html exactly
      '.slide',
      '[data-slide]',
      '.presentation-slide',
      'section[class*="slide"]',
    ];

    for (const selector of selectors) {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) {
        return Array.from(els);
      }
    }

    // Fallback: try to find a container with many children
    const container = document.querySelector(
      '#deck-container, #deck, .presentation, .deck, #slideshow'
    );
    if (container) {
      return Array.from(container.children).filter(
        (c) => c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE'
      );
    }

    return [];
  }

  // ── Single Slide Parsing ─────────────────────────────────────────
  private parseSlide(el: Element, index: number): SlideData {
    const background = this.extractBackground(el);
    const slideId = el.id || `slide-${index}`;

    // Grab a trimmed snippet of the raw HTML for later Playwright use
    const rawHtml = el.outerHTML;

    return {
      index,
      width: 1280,
      height: 720,
      slideId,
      background,
      elements: [], // Phase 2: full element tree extraction
      rawHtml,
    };
  }

  // ── Background Extraction ────────────────────────────────────────
  private extractBackground(el: Element): BackgroundStyle {
    const classList = el.className || '';
    const style = (el as HTMLElement).style || {};

    // Check inline style first
    const inlineBg = (el as HTMLElement).style?.backgroundColor;
    if (inlineBg) {
      return { color: inlineBg };
    }

    // Detect common Tailwind background class patterns
    const bgClassMatch = classList.match(/bg-([a-zA-Z]+-\d+|white|black|transparent)/);
    if (bgClassMatch) {
      return { cssClass: bgClassMatch[0] };
    }

    // Check for bg-pattern class (radial dot pattern in sample)
    if (classList.includes('bg-pattern')) {
      return { cssClass: 'bg-pattern' };
    }

    // Check for dark slide (slate-900 in sample slide 8)
    if (classList.includes('bg-slate-900')) {
      return { color: '#0f172a', cssClass: 'bg-slate-900' };
    }
    if (classList.includes('bg-slate-50')) {
      return { color: '#f8fafc', cssClass: 'bg-slate-50' };
    }
    if (classList.includes('bg-white')) {
      return { color: '#ffffff', cssClass: 'bg-white' };
    }

    return { color: '#ffffff' };
  }

  // ── Extract External Resources ────────────────────────────────────
  private extractExternalLinks(document: Document): string[] {
    const links: string[] = [];

    // Stylesheets
    document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) links.push(href);
    });

    // Scripts (like Tailwind CDN)
    document.querySelectorAll('script[src]').forEach((el) => {
      const src = el.getAttribute('src');
      if (src) links.push(src);
    });

    return links;
  }
}

export interface ParseResult {
  slides: SlideData[];
  slideCount: number;
  externalLinks: string[];
}

// Re-export types
export type { SlideData } from '@html-to-slides/shared-types';
