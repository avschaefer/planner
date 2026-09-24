/**
 * Snapshot the whole Gantt — the full timeline, not just what is on screen —
 * as a PNG.
 *
 * The chart is already SVG, so this is a clone-and-rasterise rather than a
 * re-render: copy the header and chart into one standalone SVG document, inline
 * the stylesheet (the shapes are styled entirely by class), strip the invisible
 * interaction targets, then draw it through an <img> onto a canvas.
 */

const MARGIN = 16;

export async function exportGanttPng(
  head: SVGSVGElement,
  chart: SVGSVGElement,
  name: string,
  scale = 2,
): Promise<void> {
  const headH = Number(head.getAttribute('height')) || head.getBoundingClientRect().height;
  const chartH = Number(chart.getAttribute('height')) || chart.getBoundingClientRect().height;
  const width = Number(chart.getAttribute('width')) || chart.getBoundingClientRect().width;
  const height = headH + chartH;

  const svgNS = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(svgNS, 'svg');
  out.setAttribute('xmlns', svgNS);
  out.setAttribute('width', String(width + MARGIN * 2));
  out.setAttribute('height', String(height + MARGIN * 2));
  out.setAttribute('viewBox', `0 0 ${width + MARGIN * 2} ${height + MARGIN * 2}`);
  // The palette overrides live as inline custom properties on <html>; in a
  // standalone SVG the root element is what `:root` matches, so they move here.
  out.setAttribute('style', document.documentElement.getAttribute('style') ?? '');

  const style = document.createElementNS(svgNS, 'style');
  style.textContent = collectCss();
  out.appendChild(style);

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', cssVar('--bg') || '#ffffff');
  out.appendChild(bg);

  out.appendChild(layer(chart, MARGIN, MARGIN + headH));
  out.appendChild(layer(head, MARGIN, MARGIN));

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(out)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = await load(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + MARGIN * 2) * scale);
    canvas.height = Math.ceil((height + MARGIN * 2) * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (blob) download(blob, `${name.replace(/[^\w -]/g, '') || 'schedule'}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A cloned <svg>'s children, positioned, with the interaction-only bits removed. */
function layer(src: SVGSVGElement, x: number, y: number): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${x} ${y})`);
  // Carry the root's classes (e.g. .by-type) so selectors scoped to it still match.
  g.setAttribute('class', src.getAttribute('class') ?? '');
  const clone = src.cloneNode(true) as SVGSVGElement;
  clone
    .querySelectorAll('.link-hit, .handle, .knob, .knob-hit, .marquee, .rubber, [fill="transparent"]')
    .forEach((el) => el.remove());
  while (clone.firstChild) g.appendChild(clone.firstChild);
  return g;
}

/** Every rule in the page's own stylesheets. Cross-origin sheets are skipped. */
function collectCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch {
      /* A sheet we are not allowed to read. Nothing here depends on one. */
    }
  }
  return out.join('\n');
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The chart could not be rendered to an image.'));
    img.src = url;
  });
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
