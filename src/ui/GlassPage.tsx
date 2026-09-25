import type { ReactNode } from 'react';
import { useStore } from '../store/store';
import { Aurora } from './Aurora';

/** A small bar-chart glyph. The product in one mark, at 22px. */
export function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="11" height="3.6" rx="1.8" fill="currentColor" />
      <rect x="6" y="9.2" width="14" height="3.6" rx="1.8" fill="currentColor" opacity="0.62" />
      <rect x="4" y="13.9" width="9" height="3.6" rx="1.8" fill="currentColor" opacity="0.34" />
    </svg>
  );
}

/**
 * The frame every page outside the chart shares: the aurora, the grain, the
 * hero title, and one frosted card. Sign-in, profile and the project list are
 * all this, so they cannot drift apart.
 *
 * `narrow` is for short forms (sign-in), which read better at a card's width
 * than a list's.
 */
export function GlassPage({
  children,
  narrow = false,
  wide = false,
  hero = true,
  action,
}: {
  children: ReactNode;
  narrow?: boolean;
  /** For two-column pages (the account page), so nothing needs scrolling. */
  wide?: boolean;
  /**
   * The hero title and the card's logotype. Off for working pages like the
   * account page, which carry a small logotype top-left instead.
   */
  hero?: boolean;
  /** Top-right of the card's header, e.g. the account button. */
  action?: ReactNode;
}) {
  return (
    <div className="home">
      <div className="home-bg" aria-hidden="true">
        <Aurora />
        <span className="grain" />
      </div>
      {!hero && (
        <div className="page-mark">
          <Mark />
          <span>Marga</span>
        </div>
      )}
      <div className={`home-scroll${hero ? '' : ' centred'}`}>
        {hero && (
          /* Decoration: the card's <h1> is the accessible name. */
          <div className="hero-word hero-top" aria-hidden="true">
            Marga
          </div>
        )}
        <div className={`projects glass${narrow ? ' narrow' : ''}${wide ? ' wide' : ''}`}>
          {hero && (
            <header className="brand">
              <span className="mark" aria-hidden="true">
                <Mark />
              </span>
              <h1>Marga</h1>
              {action && <span className="brand-action">{action}</span>}
            </header>
          )}
          {children}
        </div>
        <LegalLinks />
      </div>
    </div>
  );
}

/**
 * Terms, privacy and refunds live on one static page (public/legal.html) so
 * they're readable signed out; every page outside the chart links to it.
 */
function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal">
      <a href="/legal.html#terms">Terms</a>
      <a href="/legal.html#privacy">Privacy</a>
      <a href="/legal.html#refunds">Refunds</a>
    </nav>
  );
}

/** Initials in a circle — the way into the profile page. */
export function AccountButton() {
  const account = useStore((s) => s.account);
  const openProfile = useStore((s) => s.openProfile);
  if (!account) return null;
  const source = account.displayName || account.email;
  const initials =
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';
  return (
    <button className="avatar" onClick={openProfile} title={`Account — ${account.email}`} aria-label="Account">
      {initials}
    </button>
  );
}
