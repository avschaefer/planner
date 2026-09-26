import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../engine/types';
import { buildTimeline } from './timeline';

const schedule = { byId: new Map(), projectStart: 500, projectEnd: 540, order: [] } as ScheduleResult;

describe('buildTimeline', () => {
  it('starts early enough for a label drawn left of the first bar', () => {
    const plain = buildTimeline(schedule, 12, 0);
    const withLabel = buildTimeline(schedule, 12, 0, [{ start: 500, px: 240 }]);
    // The bar's x is now at least the label's width in from the chart's left edge.
    expect(withLabel.x(500)).toBeGreaterThanOrEqual(240);
    expect(withLabel.origin).toBeLessThan(plain.origin);
  });

  it('leaves the start alone when the label already fits', () => {
    const plain = buildTimeline(schedule, 12, 0);
    expect(buildTimeline(schedule, 12, 0, [{ start: 530, px: 40 }]).origin).toBe(plain.origin);
  });
});
