import { useEffect } from 'react';
import { DATE_FORMATS } from '../engine/calendar';
import { useStore } from '../store/store';
import { Button } from './Button';
import {
  ACCENTS,
  CRITICALS,
  GROUPS,
  type MilestoneLabel,
  type MilestoneShape,
  type Settings as S,
  type TextPos,
} from './settings';

const TEXT_POS: Array<{ id: TextPos; label: string }> = [
  { id: 'left', label: 'Left' },
  { id: 'inside', label: 'Inside' },
  { id: 'right', label: 'Right' },
  { id: 'none', label: 'None' },
];

const MS_SHAPES: Array<{ id: MilestoneShape; label: string }> = [
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
];

const MS_LABELS: Array<{ id: MilestoneLabel; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'date', label: 'Date' },
  { id: 'both', label: 'Name + date' },
  { id: 'none', label: 'None' },
];

/** Presentation settings. Everything here redraws the chart; nothing reschedules it. */
export function SettingsModal({ onClose }: { onClose(): void }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  const seg = <K extends keyof S>(key: K, options: Array<{ id: S[K]; label: string }>) => (
    <div className="seg">
      {options.map((o) => (
        <Button
          key={String(o.id)}
          variant="secondary"
          size="sm"
          active={settings[key] === o.id}
          onClick={() => update({ [key]: o.id } as Partial<S>)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      <div className="modal-scrim" onPointerDown={onClose} />
      <div className="modal" role="dialog" aria-label="Settings">
        <header>
          <h3>Settings</h3>
          <Button variant="ghost" size="sm" icon onClick={onClose} title="Close (Esc)">
            ✕
          </Button>
        </header>

        <div className="modal-body">
          <section>
            <h4>Colour</h4>

            <div className="field">
              <label>Accent</label>
              <div className="swatches">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    className={`swatch${settings.accent === a.id ? ' on' : ''}`}
                    title={a.label}
                    onClick={() => update({ accent: a.id })}
                  >
                    <span style={{ background: a.swatch }} />
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Summary groups</label>
              <div className="swatches">
                {GROUPS.map((g) => (
                  <button
                    key={g.id}
                    className={`swatch wide${settings.groups === g.id ? ' on' : ''}`}
                    title={g.label}
                    onClick={() => update({ groups: g.id })}
                  >
                    {g.swatches.map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Critical path</label>
              <div className="swatches">
                {CRITICALS.map((c) => (
                  <button
                    key={c.id}
                    className={`swatch${settings.critical === c.id ? ' on' : ''}`}
                    title={c.label}
                    onClick={() => update({ critical: c.id })}
                  >
                    <span style={{ background: c.swatch }} />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h4>Activity bars</h4>
            <div className="field">
              <label>Shape</label>
              {seg('barShape', [
                { id: 'rounded', label: 'Rounded' },
                { id: 'square', label: 'Square' },
              ])}
            </div>
            <div className="field">
              <label>Name</label>
              {seg('barText', TEXT_POS)}
            </div>
          </section>

          <section>
            <h4>Summary bars</h4>
            <div className="field">
              <label>Shape</label>
              {seg('summaryShape', [
                { id: 'bracket', label: 'Bracket' },
                { id: 'bar', label: 'Solid bar' },
              ])}
            </div>
            <div className="field">
              <label>Name</label>
              {seg('summaryText', TEXT_POS)}
            </div>
          </section>

          <section>
            <h4>Milestones</h4>
            <div className="field">
              <label>Shape</label>
              {seg('milestoneShape', MS_SHAPES)}
            </div>
            <div className="field">
              <label>Label</label>
              {seg('milestoneLabel', MS_LABELS)}
            </div>
            <div className="field">
              <label>Side</label>
              {seg('milestoneSide', [
                { id: 'left', label: 'Left' },
                { id: 'right', label: 'Right' },
              ])}
            </div>
          </section>

          <section>
            <h4>Chart</h4>
            <div className="field">
              <label>Dates</label>
              {seg(
                'dateFormat',
                DATE_FORMATS.map((f) => ({ id: f.id, label: f.label })),
              )}
            </div>
            <div className="field">
              <label>Float tails</label>
              {seg('floatTails', [
                { id: true, label: 'Show' },
                { id: false, label: 'Hide' },
              ])}
              <p className="note">
                The dashed line after a bar showing how far it can slip before it moves the finish.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
