'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Layers, ChevronRight, Download, FileText,
  Image, Presentation, Loader2, CheckCircle,
  AlertCircle, ChevronLeft, ChevronRight as ChevRight,
  Maximize2, X
} from 'lucide-react';
import clsx from 'clsx';

const API = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

type ExportFormat = 'pptx' | 'pdf' | 'png' | 'jpg';
type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface Project {
  id: string;
  name: string;
  slide_count: number;
  file_size: number;
  created_at: string;
  exports: ExportJob[];
}

interface ExportJob {
  id: string;
  format: ExportFormat;
  status: JobStatus;
  progress: number;
  file_key?: string;
  filename?: string;
  file_size?: number;
  error_msg?: string;
  created_at: string;
  completed_at?: string;
}

const FORMAT_CONFIG: Record<ExportFormat, { label: string; ext: string; desc: string; icon: React.ReactNode }> = {
  pptx: {
    label: 'PowerPoint',
    ext: '.pptx',
    desc: 'Editable slides',
    icon: <Presentation size={22} />,
  },
  pdf: {
    label: 'PDF',
    ext: '.pdf',
    desc: 'Print-ready',
    icon: <FileText size={22} />,
  },
  png: {
    label: 'PNG (ZIP)',
    ext: '.zip',
    desc: 'High quality images',
    icon: <Image size={22} />,
  },
  jpg: {
    label: 'JPG (ZIP)',
    ext: '.zip',
    desc: 'Compressed images',
    icon: <Image size={22} />,
  },
};

export default function ProjectPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pptx');
  const [activeJob, setActiveJob] = useState<ExportJob | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Load project
  useEffect(() => {
    fetch(`${API}/projects/${params.id}`)
      .then((r) => r.json())
      .then(setProject);
  }, [params.id]);

  // Drive the iframe to the correct slide
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !project) return;

    const driveSlide = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const slides = doc.querySelectorAll<HTMLElement>('.slide');
        slides.forEach((el, i) => {
          if (i === activeSlide) {
            el.classList.add('active');
          } else {
            el.classList.remove('active');
          }
        });
        // Also hide controls
        const controls = doc.getElementById('controls');
        if (controls) controls.style.display = 'none';
      } catch {
        // Cross-origin or not loaded yet — skip
      }
    };

    iframe.addEventListener('load', driveSlide);
    driveSlide();

    return () => iframe.removeEventListener('load', driveSlide);
  }, [activeSlide, project]);

  // Poll active job
  const startPoll = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API}/jobs/${jobId}`);
      const job: ExportJob = await res.json();
      setActiveJob(job);

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(pollRef.current!);
        // Refresh project to get updated exports list
        fetch(`${API}/projects/${params.id}`)
          .then((r) => r.json())
          .then(setProject);
      }
    }, 1500);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const triggerExport = async () => {
    if (!project) return;

    const res = await fetch(`${API}/projects/${project.id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: selectedFormat }),
    });
    const data = await res.json();
    if (data.jobId) {
      const newJob: ExportJob = {
        id: data.jobId,
        format: selectedFormat,
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString(),
      };
      setActiveJob(newJob);
      startPoll(data.jobId);
    }
  };

  const downloadUrl = (job: ExportJob) => `${API}/download/${job.id}`;

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-2 shrink-0">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Layers size={14} className="text-white" />
          </div>
          <span className="font-bold tracking-tight">HTML to Slides</span>
        </Link>
        <ChevronRight size={14} className="text-[var(--text-muted)]" />
        <Link href="/projects" className="text-[var(--text-muted)] hover:text-white text-sm transition-colors">Projects</Link>
        <ChevronRight size={14} className="text-[var(--text-muted)]" />
        <span className="text-sm truncate max-w-[200px]">{project.name}</span>
        <span className="ml-2 text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border)] px-2 py-0.5 rounded-full">
          {project.slide_count} slides
        </span>
      </header>

      {/* ── Main layout ─────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Slide Navigator ─────────────────────────── */}
        <aside className="w-48 border-r border-[var(--border)] flex flex-col overflow-y-auto shrink-0 bg-[var(--bg-card)]/50">
          <p className="text-xs text-[var(--text-muted)] font-medium px-3 pt-4 pb-2 uppercase tracking-wider">
            Slides
          </p>
          <div className="px-2 pb-4 space-y-2">
            {Array.from({ length: project.slide_count }, (_, i) => (
              <button
                key={i}
                onClick={() => setActiveSlide(i)}
                className={clsx(
                  'w-full text-left',
                  'slide-thumb',
                  activeSlide === i && 'active'
                )}
              >
                {/* Mini preview — iframe scaled down */}
                <div className="relative w-full bg-white overflow-hidden" style={{ paddingBottom: '56.25%' }}>
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs font-medium bg-slate-50">
                    Slide {i + 1}
                  </div>
                </div>
                <div className={clsx(
                  'text-xs px-2 py-1.5 flex items-center gap-1.5',
                  activeSlide === i ? 'text-indigo-400' : 'text-[var(--text-muted)]'
                )}>
                  <span className="font-medium">{i + 1}</span>
                  <span className="truncate">/ {project.slide_count}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Center: Preview ────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Slide toolbar */}
          <div className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveSlide((s) => Math.max(0, s - 1))}
              disabled={activeSlide === 0}
              className="p-1.5 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-[var(--text-muted)]">
              <span className="text-white font-medium">{activeSlide + 1}</span> / {project.slide_count}
            </span>
            <button
              onClick={() => setActiveSlide((s) => Math.min(project.slide_count - 1, s + 1))}
              disabled={activeSlide === project.slide_count - 1}
              className="p-1.5 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-colors"
            >
              <ChevRight size={16} />
            </button>

            <div className="ml-auto">
              <button
                onClick={() => setFullscreen(true)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-muted)] hover:text-white transition-colors"
                title="Fullscreen preview"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>

          {/* Iframe container */}
          <div className="flex-1 flex items-center justify-center bg-[#060b17] overflow-hidden p-6">
            <div className="relative shadow-2xl rounded-xl overflow-hidden" style={{ width: '100%', maxWidth: '1000px', aspectRatio: '16/9' }}>
              <iframe
                ref={iframeRef}
                src={`${API}/projects/${project.id}/html`}
                className="w-full h-full border-0"
                style={{ transformOrigin: 'top left' }}
                title="Slide preview"
              />
            </div>
          </div>
        </div>

        {/* ── Right: Export Panel ───────────────────────────── */}
        <aside className="w-72 border-l border-[var(--border)] flex flex-col shrink-0 overflow-y-auto">
          <div className="p-5 border-b border-[var(--border)]">
            <h2 className="font-semibold mb-4">Export</h2>

            {/* Format selector */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {(Object.entries(FORMAT_CONFIG) as [ExportFormat, typeof FORMAT_CONFIG.pptx][]).map(([fmt, cfg]) => (
                <button
                  key={fmt}
                  onClick={() => setSelectedFormat(fmt)}
                  className={clsx('format-btn', selectedFormat === fmt && 'selected')}
                >
                  {cfg.icon}
                  <span>{cfg.label}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{cfg.desc}</span>
                </button>
              ))}
            </div>

            {/* Export button */}
            <button
              onClick={triggerExport}
              disabled={activeJob?.status === 'pending' || activeJob?.status === 'processing'}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {activeJob?.status === 'processing' || activeJob?.status === 'pending' ? (
                <><Loader2 size={16} className="animate-spin" /> Exporting...</>
              ) : (
                <><Download size={16} /> Export {FORMAT_CONFIG[selectedFormat].label}</>
              )}
            </button>
          </div>

          {/* Active job progress */}
          {activeJob && (
            <div className="p-5 border-b border-[var(--border)] animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">
                  {FORMAT_CONFIG[activeJob.format].label} Export
                </span>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full border', {
                  'text-yellow-400 border-yellow-400/30 bg-yellow-400/10': activeJob.status === 'pending',
                  'text-blue-400 border-blue-400/30 bg-blue-400/10': activeJob.status === 'processing',
                  'text-green-400 border-green-400/30 bg-green-400/10': activeJob.status === 'completed',
                  'text-red-400 border-red-400/30 bg-red-400/10': activeJob.status === 'failed',
                })}>
                  {activeJob.status}
                </span>
              </div>

              {(activeJob.status === 'processing' || activeJob.status === 'pending') && (
                <div className="progress-bar mb-2">
                  <div className="progress-fill" style={{ width: `${activeJob.progress}%` }} />
                </div>
              )}

              {activeJob.status === 'completed' && (
                <a
                  href={downloadUrl(activeJob)}
                  className="flex items-center justify-center gap-2 w-full mt-3 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                  download
                >
                  <Download size={15} /> Download {activeJob.filename}
                </a>
              )}

              {activeJob.status === 'failed' && (
                <p className="text-red-400 text-xs mt-2">{activeJob.error_msg}</p>
              )}
            </div>
          )}

          {/* Export history */}
          {project.exports.length > 0 && (
            <div className="p-5">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">History</p>
              <div className="space-y-2">
                {project.exports.slice(0, 5).map((job) => (
                  <div key={job.id} className="flex items-center gap-3 text-sm">
                    {job.status === 'completed'
                      ? <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                      : job.status === 'failed'
                      ? <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                      : <Loader2 size={14} className="text-indigo-400 flex-shrink-0 animate-spin" />
                    }
                    <span className="text-[var(--text-muted)] flex-1 truncate">
                      {FORMAT_CONFIG[job.format].label}
                    </span>
                    {job.status === 'completed' && (
                      <a
                        href={downloadUrl(job)}
                        className="text-indigo-400 hover:text-indigo-300 text-xs"
                        download
                        title="Download again"
                      >
                        <Download size={13} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Fullscreen overlay ──────────────────────────────── */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
          >
            <X size={20} />
          </button>
          <iframe
            src={`${API}/projects/${project.id}/html`}
            className="w-full h-full border-0"
            title="Fullscreen preview"
          />
        </div>
      )}
    </div>
  );
}
