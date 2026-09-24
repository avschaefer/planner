import { useStore } from '../store/store';
import { Button } from './Button';

/**
 * One editor at a time (PRD Q-6). When someone else holds the lock this is the
 * only thing that changes on screen — everything stays live and readable, the
 * edits are simply refused in `commit`.
 */
export function EditorBanner() {
  const shared = useStore((s) => s.shared);
  const readOnly = useStore((s) => s.readOnly);
  const role = useStore((s) => s.role);
  const view = useStore((s) => s.view);
  const takeOver = useStore((s) => s.takeOverEditing);

  if (!shared || view !== 'schedule') return null;

  // Shared with you as a viewer: nothing to take over, and nothing to fix.
  if (role === 'viewer') {
    return (
      <div className="editing-banner">
        <span className="dot view" />
        <span>View only · shared with you, updating live</span>
      </div>
    );
  }
  if (!readOnly) return null;

  return (
    <div className="editing-banner">
      <span className="dot" />
      <span>Someone else is editing · viewing live</span>
      <Button variant="secondary" size="sm" onClick={() => void takeOver()}>
        Take over editing
      </Button>
    </div>
  );
}
