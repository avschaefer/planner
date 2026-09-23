import { useStore } from '../store/store';

/**
 * One editor at a time (PRD Q-6). When someone else holds the lock this is the
 * only thing that changes on screen — everything stays live and readable, the
 * edits are simply refused in `commit`.
 */
export function EditorBanner() {
  const shared = useStore((s) => s.shared);
  const readOnly = useStore((s) => s.readOnly);
  const view = useStore((s) => s.view);
  const takeOver = useStore((s) => s.takeOverEditing);

  if (!shared || !readOnly || view !== 'schedule') return null;

  return (
    <div className="editing-banner">
      <span className="dot" />
      <span>Someone else is editing · viewing live</span>
      <button onClick={() => void takeOver()}>Take over editing</button>
    </div>
  );
}
