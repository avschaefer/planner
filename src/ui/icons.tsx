/* 16px stroke icons. One file so the toolbar markup stays readable. */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const Back = () => (
  <svg {...base}>
    <path d="M9.5 3.5L5 8l4.5 4.5" />
  </svg>
);

export const Indent = () => (
  <svg {...base}>
    <path d="M2 3.5h12M6 8h8M6 12.5h8M2 6.2L4 8l-2 1.8" />
  </svg>
);

export const Outdent = () => (
  <svg {...base}>
    <path d="M2 3.5h12M6 8h8M6 12.5h8M4 6.2L2 8l2 1.8" />
  </svg>
);

export const Undo = () => (
  <svg {...base}>
    <path d="M3 7.5h7a3 3 0 010 6H6.5M3 7.5L5.8 4.7M3 7.5l2.8 2.8" />
  </svg>
);

export const Redo = () => (
  <svg {...base}>
    <path d="M13 7.5H6a3 3 0 000 6h3.5M13 7.5L10.2 4.7M13 7.5l-2.8 2.8" />
  </svg>
);

export const Plus = () => (
  <svg {...base}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const Minus = () => (
  <svg {...base}>
    <path d="M3.5 8h9" />
  </svg>
);

export const Critical = () => (
  <svg {...base}>
    <path d="M2 11.5h3.5l2-7 2.5 5 1.5-3h2.5" />
  </svg>
);

export const Export = () => (
  <svg {...base}>
    <path d="M8 2.5v7M5.2 6.3L8 9.5l2.8-3.2M3 11v1.5a1 1 0 001 1h8a1 1 0 001-1V11" />
  </svg>
);

export const Keyboard = () => (
  <svg {...base}>
    <rect x="1.8" y="4.2" width="12.4" height="7.6" rx="1.5" />
    <path d="M4.5 7h.01M7 7h.01M9.5 7h.01M11.5 7h.01M5 9.4h6" />
  </svg>
);

/* Sliders rather than a cog — a cog at 16px reads as a sunburst. */
export const Gear = () => (
  <svg {...base}>
    <path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h1.5M7 11.5h6.5" />
    <circle cx="8" cy="4.5" r="1.8" />
    <circle cx="5.5" cy="11.5" r="1.8" />
  </svg>
);

export const Image = () => (
  <svg {...base}>
    <rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.5" />
    <path d="M2.4 10.6L5.6 7.6l2.6 2.4 2-1.8 3.2 3" />
    <circle cx="5.7" cy="6" r="0.9" />
  </svg>
);

export const PanelLeft = () => (
  <svg {...base}>
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5" />
    <path d="M6.3 2.8v10.4" />
  </svg>
);
