import type { Link, LinkType } from './types';

const TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * MS Project's predecessor shorthand, against the outline row numbers produced
 * by engine/ids.ts. '3', '3FS', '3FS+2d', '3-1d' and the reversed 'FS3' form
 * all parse; output is MSP-canonical: '3', '4SS+2d', '7FS-1d'.
 */
export function formatPredecessors(links: Link[], rowIdOf: (id: string) => number | undefined): string {
  return links
    .map((l) => {
      const n = rowIdOf(l.fromId);
      if (n === undefined) return null;
      // MSP omits the type only when the whole relationship is the default.
      const type = l.type === 'FS' && l.lag === 0 ? '' : l.type;
      const lag = l.lag === 0 ? '' : `${l.lag > 0 ? '+' : '-'}${Math.abs(l.lag)}d`;
      return `${n}${type}${lag}`;
    })
    .filter((s): s is string => s !== null)
    .join(', ');
}

export interface ParsedPredecessor {
  fromId: string;
  type: LinkType;
  lag: number;
}

export interface ParseResult {
  links: ParsedPredecessor[];
  error: string | null;
}

/*
 * Either order: number-then-type (MSP's own form) or type-then-number (what
 * people type when they think "finish-to-start on 3"). Spaces are allowed
 * inside a token — '2 SS +1d' — and also separate tokens, so the scanner
 * matches greedily and then checks that whatever sits between two matches is
 * nothing but separators.
 */
const TOKEN =
  /(\d+)\s*(FS|SS|FF|SF)?(?:\s*([+-]\s*\d+)\s*(?:D(?:AY)?S?)?)?|(FS|SS|FF|SF)\s*(\d+)(?:\s*([+-]\s*\d+)\s*(?:D(?:AY)?S?)?)?/gi;

const SEPARATORS = /^[,;\s]*$/;

export function parsePredecessors(
  text: string,
  idForRow: (row: number) => string | undefined,
): ParseResult {
  const links: ParsedPredecessor[] = [];
  const src = text.toUpperCase();
  const fail = (from: number): ParseResult => {
    // Quote it back in the case they typed, minus the separator they got to it by.
    const rest = text.slice(from).replace(/^[,;\s]+/, '');
    const junk = (rest.split(/[,;]/)[0] || rest).trim();
    return { links: [], error: `Can't read "${junk}" — try 3FS+2d` };
  };

  TOKEN.lastIndex = 0;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN.exec(src))) {
    // Anything skipped over between tokens has to be punctuation, not content.
    if (!SEPARATORS.test(src.slice(cursor, m.index))) return fail(cursor);
    cursor = m.index + m[0].length;

    const row = Number(m[1] ?? m[5]);
    const fromId = idForRow(row);
    if (!fromId) return { links: [], error: `There is no activity ${row}` };

    const lag = m[3] ?? m[6];
    links.push({
      fromId,
      type: ((m[2] ?? m[4]) as LinkType | undefined) ?? 'FS',
      lag: lag ? Number(lag.replace(/\s+/g, '')) : 0,
    });
  }

  if (!SEPARATORS.test(src.slice(cursor))) return fail(cursor);
  return { links, error: null };
}

/** 'FS+2d' / 'SS-1' — the shorthand accepted by the dependency popover. */
export function parseRelationship(text: string): { type: LinkType; lag: number } | null {
  const m = /^(FS|SS|FF|SF)?\s*([+-]\s*\d+)?\s*d?$/i.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const type = (m[1]?.toUpperCase() as LinkType) ?? 'FS';
  if (!TYPES.includes(type)) return null;
  return { type, lag: m[2] ? Number(m[2].replace(/\s+/g, '')) : 0 };
}

export function formatRelationship(type: LinkType, lag: number): string {
  return `${type}${lag === 0 ? '' : `${lag > 0 ? '+' : '-'}${Math.abs(lag)}d`}`;
}
