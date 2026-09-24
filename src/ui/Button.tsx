import type { ButtonHTMLAttributes } from 'react';

/**
 * The one button. Every clickable control in the app is this, so size, font,
 * cursor and disabled treatment cannot drift between screens — the project
 * list's Create button once rendered as a blank box because it had grown its
 * own styling and picked up a hover rule meant for something else.
 *
 * - primary   filled accent — the one main action on a screen
 * - secondary outlined — ordinary actions
 * - ghost     borderless — tertiary actions and icon buttons
 * - danger    filled red — irreversible actions, always behind a confirmation
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square, for a button that is only an icon. */
  icon?: boolean;
  /** Pressed state, for toggles and segmented choices. */
  active?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  active = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    icon ? 'btn-icon' : '',
    active ? 'is-active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} aria-pressed={active || undefined} {...rest} />;
}
