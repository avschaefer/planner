import type { DateFormat } from '../engine/calendar';

/**
 * Presentation settings. These describe how the chart is drawn, not what it
 * schedules, so they live outside the document and outside undo — one set of
 * preferences across every project, stored in localStorage.
 */

export type TextPos = 'none' | 'left' | 'inside' | 'right';
export type BarShape = 'rounded' | 'square';
export type SummaryShape = 'bracket' | 'bar';
export type MilestoneShape = 'diamond' | 'triangle' | 'circle' | 'square';
export type MilestoneLabel = 'none' | 'name' | 'date' | 'both';

export interface Settings {
  accent: AccentId;
  groups: GroupsId;
  critical: CriticalId;
  barShape: BarShape;
  barText: TextPos;
  summaryShape: SummaryShape;
  summaryText: TextPos;
  milestoneShape: MilestoneShape;
  milestoneLabel: MilestoneLabel;
  milestoneSide: 'left' | 'right';
  dateFormat: DateFormat;
  floatTails: boolean;
  showTable: boolean;
}

export const DEFAULTS: Settings = {
  accent: 'indigo',
  groups: 'default',
  critical: 'red',
  barShape: 'rounded',
  barText: 'right',
  summaryShape: 'bracket',
  summaryText: 'right',
  milestoneShape: 'diamond',
  milestoneLabel: 'name',
  milestoneSide: 'right',
  dateFormat: 'dMMMyy',
  floatTails: true,
  showTable: true,
};

/* ---------------------------------------------------------- palettes ---- */

type Vars = Record<string, string>;

export type AccentId = 'indigo' | 'blue' | 'teal' | 'violet' | 'slate';
export type GroupsId = 'default' | 'muted' | 'mono';
export type CriticalId = 'red' | 'amber' | 'magenta';

const accentVars = (base: string, hover: string): Vars => ({
  '--accent': base,
  '--accent-hover': hover,
  '--accent-soft': hexA(base, 0.09),
  '--accent-wash': hexA(base, 0.05),
  '--accent-line': hexA(base, 0.4),
});

export const ACCENTS: Array<{ id: AccentId; label: string; swatch: string; vars: Vars }> = [
  { id: 'indigo', label: 'Indigo', swatch: '#4f5bd5', vars: accentVars('#4f5bd5', '#3f4ac2') },
  { id: 'blue', label: 'Blue', swatch: '#1f6fd0', vars: accentVars('#1f6fd0', '#175bb0') },
  { id: 'teal', label: 'Teal', swatch: '#0f847e', vars: accentVars('#0f847e', '#0b6e69') },
  { id: 'violet', label: 'Violet', swatch: '#7e46c4', vars: accentVars('#7e46c4', '#6a38a8') },
  { id: 'slate', label: 'Slate', swatch: '#4a5666', vars: accentVars('#4a5666', '#3a4552') },
];

/** Six hues, one per summary group. `bar` fills the activities inside it. */
function groupSet(sets: Array<[string, string, string]>): Vars {
  const out: Vars = {};
  sets.forEach(([strong, bar, edge], i) => {
    out[`--grp-${i}`] = strong;
    out[`--grp-${i}-bar`] = bar;
    out[`--grp-${i}-edge`] = edge;
  });
  return out;
}

export const GROUPS: Array<{ id: GroupsId; label: string; swatches: string[]; vars: Vars }> = [
  {
    id: 'default',
    label: 'Full colour',
    swatches: ['#4f5bd5', '#0f847e', '#b0761c', '#c2416b', '#7e46c4', '#5a7a26'],
    vars: groupSet([
      ['#4f5bd5', '#a8aeea', '#6570d9'],
      ['#0f847e', '#8ac9c4', '#2c9a93'],
      ['#b0761c', '#e6c489', '#c58b34'],
      ['#c2416b', '#eda6bf', '#d25c82'],
      ['#7e46c4', '#c8a7e8', '#9860d2'],
      ['#5a7a26', '#b6cb8c', '#749140'],
    ]),
  },
  {
    id: 'muted',
    label: 'Muted',
    swatches: ['#5b6a8a', '#4c7d72', '#8a7350', '#8a5f6c', '#6f5f8a', '#5f7a5b'],
    vars: groupSet([
      ['#5b6a8a', '#b6bfd2', '#7b88a3'],
      ['#4c7d72', '#b0cbc5', '#6d9a90'],
      ['#8a7350', '#d9c8ae', '#a89070'],
      ['#8a5f6c', '#d8bcc4', '#a87f8b'],
      ['#6f5f8a', '#c7bcd8', '#8d7ea8'],
      ['#5f7a5b', '#bccdb9', '#7f9a7b'],
    ]),
  },
  {
    id: 'mono',
    label: 'Greyscale',
    swatches: ['#2f3338', '#4a4f56', '#656b73', '#808790', '#9aa1aa', '#b4bbc4'],
    vars: groupSet([
      ['#2f3338', '#b9bec5', '#8d939b'],
      ['#4a4f56', '#c2c7ce', '#969ca4'],
      ['#656b73', '#cbd0d6', '#9fa5ad'],
      ['#808790', '#d4d8dd', '#a8aeb6'],
      ['#9aa1aa', '#dde0e4', '#b1b7be'],
      ['#b4bbc4', '#e6e8ec', '#bac0c7'],
    ]),
  },
];

export const CRITICALS: Array<{ id: CriticalId; label: string; swatch: string; vars: Vars }> = [
  {
    id: 'red',
    label: 'Red',
    swatch: '#d6453c',
    vars: { '--crit': '#d6453c', '--crit-bar': '#e8695f', '--crit-edge': '#c0362e', '--crit-soft': hexA('#d6453c', 0.09) },
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: '#c07a12',
    vars: { '--crit': '#c07a12', '--crit-bar': '#e5a844', '--crit-edge': '#a66610', '--crit-soft': hexA('#c07a12', 0.11) },
  },
  {
    id: 'magenta',
    label: 'Magenta',
    swatch: '#b5318a',
    vars: { '--crit': '#b5318a', '--crit-bar': '#d966b0', '--crit-edge': '#9a2874', '--crit-soft': hexA('#b5318a', 0.1) },
  },
];

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Push the chosen palette onto :root, where every rule reads it from. */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const vars: Vars = {
    ...(ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0]).vars,
    ...(GROUPS.find((g) => g.id === s.groups) ?? GROUPS[0]).vars,
    ...(CRITICALS.find((c) => c.id === s.critical) ?? CRITICALS[0]).vars,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/* ------------------------------------------------------- persistence ---- */

const KEY = 'planner.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* Private browsing, or storage full. The session still works. */
  }
}
