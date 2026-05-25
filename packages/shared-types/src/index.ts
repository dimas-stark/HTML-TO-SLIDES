// ─────────────────────────────────────────────────────────────────
// Shared TypeScript types across all packages and apps
// ─────────────────────────────────────────────────────────────────

export interface SlideData {
  index: number;
  width: number;
  height: number;
  slideId: string;
  background: BackgroundStyle;
  elements: SlideElement[];
  rawHtml?: string;
}

export interface BackgroundStyle {
  color?: string;
  gradient?: string;
  imageUrl?: string;
  cssClass?: string;
}

export interface SlideElement {
  id: string;
  type: ElementType;
  renderStrategy: RenderStrategy;
  bounds: BoundingBox;
  zIndex: number;
  textContent?: string;
  imageUrl?: string;
  styles: ComputedElementStyles;
  children?: SlideElement[];
}

export type ElementType =
  | 'heading'
  | 'paragraph'
  | 'shape'
  | 'image'
  | 'icon'
  | 'table'
  | 'list'
  | 'card'
  | 'unknown';

export type RenderStrategy = 'native-ppt' | 'image-fallback';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedElementStyles {
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  borderRadius?: number;
  opacity?: number;
  border?: string;
  padding?: string;
  hasBackdropFilter?: boolean;
  hasComplexGradient?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Project & Job types (for DB + API)
// ─────────────────────────────────────────────────────────────────

export type ExportFormat = 'pptx' | 'pdf' | 'png' | 'jpg';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ExportJobPayload {
  jobId: string;
  projectId: string;
  format: ExportFormat;
  htmlContent: string;
  slideCount: number;
  options?: ExportOptions;
}

export interface ExportOptions {
  quality?: 'normal' | 'high';
  slideRange?: [number, number];
}

export interface ExportResult {
  jobId: string;
  projectId: string;
  format: ExportFormat;
  fileKey: string;
  filename: string;
  fileSizeBytes: number;
}

export interface ApiError {
  error: string;
  details?: string;
}
