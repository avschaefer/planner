import { useRef, useState } from 'react';
import type { ProjectDoc } from '../engine/types';
import { useStore } from '../store/store';
import { Button } from './Button';
import { AccountButton, GlassPage } from './GlassPage';

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
  const nameRef = useRef<HTMLInputElement>(null);

  /** Same behaviour from Enter or the button; an empty name just asks for one. */
  function create() {
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    void createProject(name);
    setName('');
  }

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
    <GlassPage action={<AccountButton />}>
      <div className="new">
        <input
          placeholder="Name a new schedule…"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
          autoFocus
        />
        <Button variant="primary" onClick={create}>
          Create
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          Import…
        </Button>
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
              <Button
                variant="ghost"
                size="sm"
                className="del"
                title="Delete schedule"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${p.name}"? This cannot be undone.`)) void deleteProject(p.id);
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </GlassPage>
  );
}
