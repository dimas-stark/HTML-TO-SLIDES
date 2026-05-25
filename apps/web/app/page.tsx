'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useRouter } from 'next/navigation';
import {
  Upload, FileText, Layers, Zap, ArrowRight,
  CheckCircle, AlertCircle, Loader2
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;

    setFilename(file.name);
    setState('uploading');
    setError('');

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Upload failed');

      setState('success');
      setTimeout(() => router.push(`/projects/${data.id}`), 800);
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  }, [router]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/html': ['.html'] },
    maxFiles: 1,
    disabled: state === 'uploading',
  });

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="border-b border-[var(--border)] px-8 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
          <Layers size={16} className="text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">HTML to Slides</span>
        <span className="ml-2 text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border)] px-2 py-0.5 rounded-full">
          Personal Edition
        </span>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm px-4 py-1.5 rounded-full mb-6">
            <Zap size={13} />
            Export HTML presentations in seconds
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Convert Slides to<br />
            <span className="from-indigo-400 to-purple-400 bg-gradient-to-r bg-clip-text text-transparent">
              Any Format
            </span>
          </h1>
          <p className="text-[var(--text-muted)] text-lg">
            Drop your AI-generated HTML presentation and export to<br />
            PPTX, PDF, or high-quality images.
          </p>
        </div>

        {/* ── Drop Zone ────────────────────────────────────── */}
        <div className="max-w-xl w-full animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div
            {...getRootProps()}
            className={`
              relative glass p-12 text-center cursor-pointer transition-all duration-300
              ${isDragActive ? 'border-indigo-500 glow-accent scale-[1.02]' : 'hover:border-indigo-500/40'}
              ${state === 'uploading' ? 'opacity-70 cursor-not-allowed' : ''}
              ${state === 'error' ? 'border-red-500/50' : ''}
              ${state === 'success' ? 'border-green-500/50' : ''}
            `}
          >
            <input {...getInputProps()} />

            {/* ── Inner content based on state ─── */}
            {state === 'idle' && (
              <>
                <div className={`
                  w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center
                  transition-all duration-300
                  ${isDragActive
                    ? 'bg-indigo-500 shadow-lg shadow-indigo-500/30'
                    : 'bg-indigo-500/10 border border-indigo-500/20'}
                `}>
                  <Upload size={28} className={isDragActive ? 'text-white' : 'text-indigo-400'} />
                </div>
                <p className="text-lg font-semibold mb-2">
                  {isDragActive ? 'Release to upload' : 'Drop your HTML file here'}
                </p>
                <p className="text-[var(--text-muted)] text-sm">
                  or <span className="text-indigo-400 underline">click to browse</span>
                </p>
                <p className="text-[var(--text-muted)] text-xs mt-4">
                  Supports TailwindCSS-based presentations · Max 20MB
                </p>
              </>
            )}

            {state === 'uploading' && (
              <>
                <Loader2 size={40} className="mx-auto mb-4 text-indigo-400 animate-spin" />
                <p className="font-semibold">Uploading <span className="text-indigo-400">{filename}</span></p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Detecting slides...</p>
              </>
            )}

            {state === 'success' && (
              <>
                <CheckCircle size={40} className="mx-auto mb-4 text-green-400" />
                <p className="font-semibold text-green-400">Upload successful!</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Redirecting to preview...</p>
              </>
            )}

            {state === 'error' && (
              <>
                <AlertCircle size={40} className="mx-auto mb-4 text-red-400" />
                <p className="font-semibold text-red-400">Upload failed</p>
                <p className="text-[var(--text-muted)] text-sm mt-2">{error}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setState('idle'); setError(''); }}
                  className="mt-4 text-xs text-indigo-400 underline"
                >
                  Try again
                </button>
              </>
            )}

            {/* Decorative gradient blur */}
            <div className="absolute -inset-px rounded-2xl pointer-events-none overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />
            </div>
          </div>
        </div>

        {/* ── Feature chips ────────────────────────────────── */}
        <div className="flex flex-wrap justify-center gap-3 mt-10 animate-fade-in" style={{ animationDelay: '0.2s' }}>
          {[
            { icon: '📊', label: 'PPTX Export' },
            { icon: '📄', label: 'PDF Export' },
            { icon: '🖼️', label: 'PNG / JPG' },
            { icon: '⚡', label: 'Playwright Rendering' },
            { icon: '🎨', label: 'TailwindCSS Support' },
          ].map(({ icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border)] px-3 py-1.5 rounded-full"
            >
              <span>{icon}</span> {label}
            </span>
          ))}
        </div>

        {/* ── Recent projects link ──────────────────────────── */}
        <a
          href="/projects"
          className="mt-8 flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-indigo-400 transition-colors animate-fade-in"
          style={{ animationDelay: '0.3s' }}
        >
          View recent projects <ArrowRight size={14} />
        </a>
      </main>
    </div>
  );
}
