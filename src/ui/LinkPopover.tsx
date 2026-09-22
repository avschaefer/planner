import { useEffect, useRef, useState } from 'react';
import { formatRelationship, parseRelationship } from '../engine/predecessors';
import type { LinkType } from '../engine/types';
import { useStore } from '../store/store';

const TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** Editing a relationship is one text field: 'FS+2d', 'SS-1'. No dialog. */
export function LinkPopover({ anchor }: { anchor: DOMRect }) {
  const doc = useStore((s) => s.doc)!;
  const linkId = useStore((s) => s.selection.linkId)!;
  const updateLink = useStore((s) => s.updateLink);
  const deleteLink = useStore((s) => s.deleteLink);
  const notify = useStore((s) => s.notify);

  const link = doc.links.find((l) => l.id === linkId);
  const [text, setText] = useState(() => (link ? formatRelationship(link.type, link.lag) : ''));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (link) setText(formatRelationship(link.type, link.lag));
  }, [link?.id, link?.type, link?.lag]);

  useEffect(() => {
    ref.current?.select();
  }, []);

  if (!link) return null;
  const codeOf = (id: string) => doc.tasks.find((t) => t.id === id)?.code ?? '?';

  const commit = (raw: string) => {
    const parsed = parseRelationship(raw);
    if (!parsed) {
      notify(`Can't read "${raw}". Try FS+2d.`);
      return;
    }
    updateLink(link.id, parsed);
  };

  return (
    <div className="pop" style={{ left: anchor.left + 12, bottom: window.innerHeight - anchor.bottom + 12 }}>
      <h4>
        {codeOf(link.fromId)} → {codeOf(link.toId)}
      </h4>
      <div className="rel">
        {TYPES.map((t) => (
          <button
            key={t}
            className={link.type === t ? 'on' : ''}
            onClick={() => updateLink(link.id, { type: t })}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit(text);
            if (e.key === 'Escape') setText(formatRelationship(link.type, link.lag));
          }}
          onBlur={() => commit(text)}
        />
        <button className="plain" title="Delete this relationship" onClick={() => deleteLink(link.id)}>
          Remove
        </button>
      </div>
      <div className="hint">Type a relationship and lag, e.g. FS+2d, SS-1d.</div>
    </div>
  );
}
