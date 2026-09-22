import { useEffect } from 'react';
import { useStore } from './store/store';
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
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
