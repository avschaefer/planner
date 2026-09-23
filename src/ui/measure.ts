/**
 * Text measurement for SVG labels.
 *
 * SVG gives no layout box before paint, and the labels need one: a bar name
 * drawn over a dependency arrow needs a backing rectangle the exact width of
 * the text, or the arrow shows through the spaces between words and reads as a
 * row of stray dots. A 2D context measures the same string the browser will
 * draw, and the results are cached because the same names redraw every frame
 * of a gesture.
 */

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;
let font = '';

export const LABEL_SIZE = 11.5;

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (ctx && !font) {
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    font = `${LABEL_SIZE}px ${family}`;
    ctx.font = font;
  }
  return ctx;
}

export function textWidth(text: string): number {
  if (!text) return 0;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const c = context();
  // Without a canvas (very old browsers), fall back to an average glyph width.
  const w = c ? c.measureText(text).width : text.length * 6.3;
  cache.set(text, w);
  return w;
}
