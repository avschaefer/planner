import { useEffect } from 'react';
import { useStore } from './store/store';
import { AuthScreen } from './ui/AuthScreen';
import { EditorBanner } from './ui/EditorBanner';
import { ProfilePage } from './ui/ProfilePage';
import { ProjectList } from './ui/ProjectList';
import { ScheduleView } from './ui/ScheduleView';

export function App() {
  const view = useStore((s) => s.view);
  const notice = useStore((s) => s.notice);
  const init = useStore((s) => s.init);
  const shared = useStore((s) => s.shared);
  const authReady = useStore((s) => s.authReady);
  const account = useStore((s) => s.account);
  const recovery = useStore((s) => s.recovery);

  useEffect(() => {
    void init();
  }, [init]);

  // Shared builds need an account; local builds (dev, tests) never ask.
  let page;
  if (!authReady) page = <div className="home" />;
  else if (shared && recovery) page = <AuthScreen recovery />;
  else if (shared && !account) page = <AuthScreen />;
  else if (view === 'profile') page = <ProfilePage />;
  else if (view === 'schedule') page = <ScheduleView />;
  else page = <ProjectList />;

  return (
    <div className="app">
      {page}
      <EditorBanner />
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
