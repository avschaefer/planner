import { useRef, useState } from 'react';
import type { ProjectDoc } from '../engine/types';
import { useStore } from '../store/store';

/** A small bar-chart glyph. The product in one mark, at 22px. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="11" height="3.6" rx="1.8" fill="currentColor" />
      <rect x="6" y="9.2" width="14" height="3.6" rx="1.8" fill="currentColor" opacity="0.62" />
      <rect x="4" y="13.9" width="9" height="3.6" rx="1.8" fill="currentColor" opacity="0.34" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function ProjectList() {
  const { projects, loading, createProject, openProject, deleteProject, importDoc } = useStore();
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onImport(file: File) {
    try {
      const doc = JSON.parse(await file.text()) as ProjectDoc;
      if (!Array.isArray(doc.tasks) || !Array.isArray(doc.links)) throw new Error('shape');
      await importDoc(doc);
    } catch {
      useStore.getState().notify("That file isn't a Marga schedule.");
    }
  }

  return (
    <div className="projects">
      <header className="brand">
        <span className="mark" aria-hidden="true">
          <Mark />
        </span>
        <h1>Marga</h1>
      </header>

      <div className="new">
        <input
          placeholder="Name a new schedule…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              void createProject(name);
              setName('');
            }
          }}
          autoFocus
        />
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => name.trim() && (void createProject(name), setName(''))}
        >
          Create
        </button>
        <button className="plain" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {loading ? null : projects.length === 0 ? (
        <div className="empty">Nothing here yet. Name a schedule above and press Enter.</div>
      ) : (
        <div className="plist">
          {projects.map((p) => (
            <div key={p.id} className="pitem" onClick={() => void openProject(p.id)}>
              <span className="rule" aria-hidden="true" />
              <span className="name">{p.name}</span>
              <span className="count">
                {p.taskCount} {p.taskCount === 1 ? 'activity' : 'activities'}
              </span>
              <span className="when">{relativeTime(p.updatedAt)}</span>
              <button
                className="plain del"
                title="Delete schedule"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${p.name}"? This cannot be undone.`)) void deleteProject(p.id);
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
