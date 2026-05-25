'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers, FileText, Trash2, Clock, ChevronRight, Plus } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

interface Project {
  id: string;
  name: string;
  slide_count: number;
  file_size: number;
  created_at: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch(`${API}/projects`);
      const data = await res.json();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await fetch(`${API}/projects/${id}`, { method: 'DELETE' });
    setProjects((p) => p.filter((x) => x.id !== id));
  };

  const fmt = (bytes: number) =>
    bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] px-8 py-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Layers size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">HTML to Slides</span>
        </Link>
        <ChevronRight size={16} className="text-[var(--text-muted)]" />
        <span className="text-[var(--text-muted)]">Projects</span>

        <div className="ml-auto">
          <Link
            href="/"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={15} /> New Upload
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
        <h1 className="text-2xl font-bold mb-6">Recent Projects</h1>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="glass p-12 text-center">
            <FileText size={40} className="mx-auto mb-4 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">No projects yet. Upload your first HTML presentation.</p>
            <Link href="/" className="inline-flex items-center gap-2 mt-4 text-indigo-400 hover:text-indigo-300 text-sm">
              <Plus size={14} /> Upload now
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="glass flex items-center gap-5 p-5 hover:border-indigo-500/40 hover:bg-[var(--bg-card-hover)] transition-all duration-200 block"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-indigo-400" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{p.name}</p>
                <p className="text-sm text-[var(--text-muted)] mt-0.5 flex items-center gap-3">
                  <span>{p.slide_count} slides</span>
                  <span>·</span>
                  <span>{fmt(p.file_size)}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {fmtDate(p.created_at)}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <ChevronRight size={16} className="text-[var(--text-muted)]" />
                <button
                  onClick={(e) => { e.preventDefault(); del(p.id); }}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title="Delete project"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
