import type { Link, LinkType, Task } from './types';

const TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** 'A1010, A1020 SS+3, A1030 FS-2' */
export function formatPredecessors(links: Link[], codeOf: (id: string) => string): string {
  return links
    .map((l) => {
      const type = l.type === 'FS' ? '' : ` ${l.type}`;
      const lag = l.lag === 0 ? '' : `${l.lag > 0 ? '+' : ''}${l.lag}d`;
      return `${codeOf(l.fromId)}${type}${lag && !type ? ' ' : ''}${lag}`;
    })
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

/**
 * Accepts the shorthand a scheduler would type: a code, optionally a
 * relationship type, optionally a lag. 'A1020 SS+3', 'A1020SS+3', 'A1020 +2'.
 */
export function parsePredecessors(text: string, tasks: Task[]): ParseResult {
  const byCode = new Map(tasks.map((t) => [t.code.toUpperCase(), t.id]));
  const links: ParsedPredecessor[] = [];

  for (const raw of text.split(',')) {
    const token = raw.trim();
    if (!token) continue;

    const m = /^([A-Za-z0-9_.-]+?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?\s*d?$/i.exec(token);
    if (!m) return { links: [], error: `Can't read "${token}"` };

    const id = byCode.get(m[1].toUpperCase());
    if (!id) return { links: [], error: `No activity "${m[1]}"` };

    links.push({
      fromId: id,
      type: (m[2]?.toUpperCase() as LinkType) ?? 'FS',
      lag: m[3] ? Number(m[3].replace(/\s+/g, '')) : 0,
    });
  }
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
  return `${type}${lag === 0 ? '' : `${lag > 0 ? '+' : ''}${lag}d`}`;
}
