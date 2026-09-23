import { useEffect } from 'react';
import { useStore } from './store/store';
import { EditorBanner } from './ui/EditorBanner';
import { ProjectList } from './ui/ProjectList';
import { ScheduleView } from './ui/ScheduleView';

export function App() {
  const view = useStore((s) => s.view);
  const notice = useStore((s) => s.notice);
  const init = useStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      {view === 'projects' ? <ProjectList /> : <ScheduleView />}
      <EditorBanner />
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
