import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';

/**
 * The home page's living background: aurora ribbons and soft colour fields,
 * drifting on slow, unrelated waves.
 *
 * Drawn on a deliberately tiny canvas (about 200px wide) that CSS scales to the
 * window and blurs. Upscaling does the softening for free, so each frame is a
 * few thousand pixels of work, not millions. Every visit is seeded afresh, so
 * the composition is never the same twice, and each path wanders across the
 * whole field rather than orbiting a corner.
 *
 * Colours: the live accent, plus a fixed lilac / rose / peach / sky family
 * chosen to sit with it. Motion stops, leaving one still frame, when the
 * system asks for reduced motion.
 */

type RGB = [number, number, number];

const FAMILY: string[] = ['#b6a4f0', '#eaa2c2', '#f6c4a2', '#a8c0f4'];
const PAPER = '#fcfcfb';
const WIDTH = 200;
const FRAME_MS = 1000 / 30;
const TAU = Math.PI * 2;

function rgb(hex: string): RGB {
  const h = hex.trim().replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [79, 91, 213];
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

/** Small, fast, seedable PRNG, so one visit's randomness is internally consistent. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Field {
  color: RGB;
  bx: number; by: number;
  ax: number; ay: number;
  fx: number; fy: number; f2: number;
  px: number; py: number; p2: number;
  r: number; alpha: number;
}

interface Ribbon {
  a: RGB; b: RGB;
  base: number; amp: number; amp2: number;
  k: number; k2: number;
  w: number; w2: number;
  phase: number; phase2: number;
  thick: number; alpha: number;
}

function compose(accent: RGB, seed: number) {
  const rand = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const family = FAMILY.map(rgb);
  // Shuffle so which colour leads changes from visit to visit.
  for (let i = family.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [family[i], family[j]] = [family[j], family[i]];
  }
  const colors = [accent, ...family];

  const fields: Field[] = colors.map((color, i) => ({
    color,
    bx: between(0.2, 0.8),
    by: between(0.2, 0.8),
    ax: between(0.22, 0.42),
    ay: between(0.2, 0.38),
    // Cycles per second: every period lands somewhere between ~40s and ~2min.
    fx: between(0.008, 0.024),
    fy: between(0.008, 0.024),
    f2: between(0.02, 0.04),
    px: between(0, TAU),
    py: between(0, TAU),
    p2: between(0, TAU),
    r: between(0.34, 0.58),
    alpha: i === 0 ? 0.5 : between(0.45, 0.65),
  }));

  const ribbons: Ribbon[] = Array.from({ length: 3 }, (_, i) => ({
    a: colors[(i + 1) % colors.length],
    b: colors[(i + 3) % colors.length],
    base: between(0.25, 0.75),
    amp: between(0.12, 0.24),
    amp2: between(0.04, 0.1),
    k: between(1.2, 2.6),
    k2: between(3, 5.5),
    w: between(0.05, 0.11) * (rand() < 0.5 ? -1 : 1),
    w2: between(0.08, 0.16) * (rand() < 0.5 ? -1 : 1),
    phase: between(0, TAU),
    phase2: between(0, TAU),
    thick: between(0.12, 0.2),
    // Kept light: the ribbons should read as silk under the glass, not paint.
    alpha: between(0.24, 0.38),
  }));

  return { fields, ribbons };
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  scene: ReturnType<typeof compose>,
) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  const span = Math.max(w, h);

  for (const f of scene.fields) {
    // Two incommensurate waves per axis read as a wander, not an orbit.
    const x = (f.bx + f.ax * (0.7 * Math.sin(TAU * f.fx * t + f.px) + 0.3 * Math.sin(TAU * f.f2 * t + f.p2))) * w;
    const y = (f.by + f.ay * (0.7 * Math.sin(TAU * f.fy * t + f.py) + 0.3 * Math.cos(TAU * f.f2 * t + f.p2))) * h;
    const r = f.r * span * (0.9 + 0.12 * Math.sin(TAU * f.f2 * 0.5 * t + f.px));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(f.color, f.alpha));
    g.addColorStop(0.55, rgba(f.color, f.alpha * 0.35));
    g.addColorStop(1, rgba(f.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Aurora ribbons: broad bands whose centre line is two travelling waves.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const rb of scene.ribbons) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 8; i++) {
      const u = -0.1 + (i / 8) * 1.2;
      const y =
        rb.base +
        rb.amp * Math.sin(rb.k * TAU * u * 0.5 + rb.w * TAU * t + rb.phase) +
        rb.amp2 * Math.sin(rb.k2 * TAU * u * 0.5 - rb.w2 * TAU * t + rb.phase2);
      pts.push([u * w, y * h]);
    }
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgba(rb.a, 0));
    g.addColorStop(0.3, rgba(rb.a, rb.alpha));
    g.addColorStop(0.7, rgba(rb.b, rb.alpha));
    g.addColorStop(1, rgba(rb.b, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = rb.thick * h;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    // Smooth through the points with midpoint quadratics.
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  }
}

export function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Re-compose when the accent changes, so the backdrop follows Settings.
  const accentId = useStore((s) => s.settings.accent);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const accent = rgb(getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4f5bd5');
    const scene = compose(accent, Math.floor(Math.random() * 2 ** 32));
    // Start part-way through, so the first frame is already mid-flow.
    const offset = Math.random() * 500;

    const size = () => {
      canvas.width = WIDTH;
      canvas.height = Math.max(90, Math.round((WIDTH * window.innerHeight) / Math.max(1, window.innerWidth)));
    };
    size();
    window.addEventListener('resize', size);

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      draw(ctx, canvas.width, canvas.height, offset, scene);
      return () => window.removeEventListener('resize', size);
    }

    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(ctx, canvas.width, canvas.height, offset + (now - start) / 1000, scene);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, [accentId]);

  return <canvas ref={ref} className="aurora" aria-hidden="true" />;
}
