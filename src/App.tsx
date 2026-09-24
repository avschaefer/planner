import { useEffect, useState } from 'react';
import { hasAccess } from './persist/access';
import { useStore } from './store/store';
import { AuthScreen } from './ui/AuthScreen';
import { EditorBanner } from './ui/EditorBanner';
import { LockoutScreen } from './ui/LockoutScreen';
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

  // A trial ends at a moment, not on an event: re-check the clock every
  // minute so the lockout appears on time. (The database already refuses.)
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const locked = shared && !!account && !(account.billing && hasAccess(account.billing));

  // Shared builds need an account; local builds (dev, tests) never ask.
  let page;
  if (!authReady) page = <div className="home" />;
  else if (shared && recovery) page = <AuthScreen recovery />;
  else if (shared && !account) page = <AuthScreen />;
  else if (view === 'profile') page = <ProfilePage />;
  // No trial and no subscription: the account page and sign-out, nothing else.
  else if (locked) page = <LockoutScreen />;
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
