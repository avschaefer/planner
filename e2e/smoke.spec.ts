import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke coverage for the interactions that can't be unit tested: rendering,
 * quick-add, inline editing, bar dragging, link dragging, multi-select and
 * undo. The scheduling maths itself is covered by the Vitest fixtures.
 */

async function newSchedule(page: Page, names: string[]) {
  await page.goto('/');
  await page.getByPlaceholder('Name a new schedule…').fill('Smoke test');
  await page.getByPlaceholder('Name a new schedule…').press('Enter');
  await expect(page.locator('.toolbar .title')).toHaveText('Smoke test');

  await page.getByRole('button', { name: 'Add activity' }).first().click();
  for (const name of names) {
    const input = page.locator('.trow input');
    await input.fill(name);
    await input.press('Enter');
  }
  // Enter on the last name opened one more blank row; Escape discards it.
  await page.locator('.trow input').press('Escape');
  await expect(page.locator('.trow')).toHaveCount(names.length);
}

async function setDuration(page: Page, row: number, days: number) {
  await page.locator('.trow').nth(row).locator('.td.dur').click();
  const input = page.locator('.trow').nth(row).locator('input');
  await input.fill(String(days));
  await input.press('Enter');
}

async function setPredecessor(page: Page, row: number, text: string) {
  await page.locator('.trow').nth(row).locator('.td.pred').click();
  const input = page.locator('.trow').nth(row).locator('input');
  await input.fill(text);
  await input.press('Enter');
}

/** Select a row without opening its name editor. */
function pickRow(page: Page, row: number) {
  return page.locator('.trow').nth(row).locator('.td.code').click();
}

const startCell = (page: Page, row: number) => page.locator('.trow').nth(row).locator('.td.date').first();
const finishCell = (page: Page, row: number) => page.locator('.trow').nth(row).locator('.td.date').nth(1);

test('creates a schedule and adds activities with the keyboard', async ({ page }) => {
  await newSchedule(page, ['Design enclosure', 'Machine parts', 'Assemble']);
  await expect(page.locator('.trow').nth(0).locator('.tname .label')).toHaveText('Design enclosure');
  await expect(page.locator('.trow').nth(2).locator('.tname .label')).toHaveText('Assemble');
  await expect(page.locator('.bar')).toHaveCount(3);
});

test('activities are numbered 1, 2, 3', async ({ page }) => {
  await newSchedule(page, ['A', 'B', 'C']);
  await expect(page.locator('.trow .td.code')).toHaveText(['1', '2', '3']);

  // Indenting changes the outline, never the numbering.
  await pickRow(page, 1);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.trow .td.code')).toHaveText(['1', '2', '3']);
});

test('duration edits change the finish date', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  const before = await finishCell(page, 0).innerText();
  await setDuration(page, 0, 10);
  expect(await finishCell(page, 0).innerText()).not.toBe(before);
  await expect(page.locator('.trow').nth(0).locator('.td.dur')).toHaveText('10d');
});

test('a typed predecessor propagates and marks the chain critical', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 5);

  const before = await startCell(page, 1).innerText();
  await setPredecessor(page, 1, '1');

  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('1');
  expect(await startCell(page, 1).innerText()).not.toBe(before);
  await expect(page.locator('.bar.critical')).toHaveCount(2);
});

test('MS Project shorthand sets the relationship type and lag', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 5);

  await setPredecessor(page, 1, '1');
  const fs = await startCell(page, 1).innerText();

  await setPredecessor(page, 1, '1SS+2d');
  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('1SS+2d');
  const ss = await startCell(page, 1).innerText();
  expect(ss).not.toBe(fs);

  // The reversed, type-first form is the same link.
  await setPredecessor(page, 1, 'SS1+2d');
  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('1SS+2d');
  expect(await startCell(page, 1).innerText()).toBe(ss);
});

test('a start date is picked from the calendar', async ({ page }) => {
  await newSchedule(page, ['A']);
  const before = await startCell(page, 0).innerText();

  await startCell(page, 0).click();
  await expect(page.locator('.datepick')).toBeVisible();

  // The first selectable weekday of the following month.
  await page.locator('.datepick .dp-head button').nth(1).click();
  await page.locator('.datepick .dp-day:not(.other):not(.weekend)').first().click();

  await expect(page.locator('.datepick')).toHaveCount(0);
  expect(await startCell(page, 0).innerText()).not.toBe(before);
  await expect(page.locator('.trow').nth(0).locator('.pin')).toBeVisible();
});

test('dragging a bar reschedules it, and undo puts it back', async ({ page }) => {
  await newSchedule(page, ['A']);
  const before = await startCell(page, 0).innerText();

  const box = (await page.locator('.bar').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 112, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  expect(await startCell(page, 0).innerText()).not.toBe(before);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(startCell(page, 0)).toHaveText(before);
});

test('dragging the right edge changes duration', async ({ page }) => {
  await newSchedule(page, ['A']);
  await expect(page.locator('.trow').nth(0).locator('.td.dur')).toHaveText('1d');

  const box = (await page.locator('.bar').first().boundingBox())!;
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 64, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const dur = await page.locator('.trow').nth(0).locator('.td.dur').innerText();
  expect(Number(dur.replace('d', ''))).toBeGreaterThan(1);
});

test('dragging from the finish handle onto a row creates an FS link', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 4);

  const barA = (await page.locator('.bar').first().boundingBox())!;
  await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2);
  const knob = (await page.locator('.knob').nth(1).boundingBox())!; // the finish handle

  // Drop far to the left of B's bar: anywhere in the row is a valid target,
  // and the left half means "to its start".
  const barB = (await page.locator('.bar').nth(1).boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(barB.x - 40, barB.y + barB.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('1');
  await expect(page.locator('.link')).toHaveCount(1);
});

test('dragging from the start handle onto a bar start creates an SS link', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 6);

  const barA = (await page.locator('.bar').first().boundingBox())!;
  await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2);
  const knob = (await page.locator('.knob').first().boundingBox())!; // the start handle

  const barB = (await page.locator('.bar').nth(1).boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(barB.x - 20, barB.y + barB.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('1SS');
});

test('a rubber band selects several bars and drags them together', async ({ page }) => {
  await newSchedule(page, ['A', 'B', 'C']);
  const barA = (await page.locator('.bar').nth(0).boundingBox())!;
  const barC = (await page.locator('.bar').nth(2).boundingBox())!;
  const startA = await startCell(page, 0).innerText();
  const startC = await startCell(page, 2).innerText();

  await page.mouse.move(barA.x - 30, barA.y + barA.height / 2);
  await page.mouse.down();
  await page.mouse.move(barC.x + barC.width + 10, barC.y + barC.height + 8, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.trow.sel')).toHaveCount(3);

  await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2);
  await page.mouse.down();
  await page.mouse.move(barA.x + barA.width / 2 + 96, barA.y + barA.height / 2, { steps: 8 });
  await page.mouse.up();

  expect(await startCell(page, 0).innerText()).not.toBe(startA);
  expect(await startCell(page, 2).innerText()).not.toBe(startC);
});

test('rows are dragged up, down, and into a summary', async ({ page }) => {
  await newSchedule(page, ['A', 'B', 'C']);
  const body = (await page.locator('.tbody').boundingBox())!;
  const grip = async (row: number) => (await page.locator('.trow').nth(row).locator('.td.grip').boundingBox())!;

  // C to the top, dropped at depth 0.
  let g = await grip(2);
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 70, body.y + 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.trow .tname .label')).toHaveText(['C', 'A', 'B']);

  // A dropped one level in, under C, by dragging to the right of the gap.
  g = await grip(1);
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 110, body.y + 32, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('.trow.summary')).toHaveCount(1);
  await expect(page.locator('.trow').nth(0).locator('.tname .label')).toHaveText('C');
  await expect(page.locator('.rail')).toHaveCount(1);
});

test('a circular link is refused', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setPredecessor(page, 1, '1');
  await setPredecessor(page, 0, '2');

  await expect(page.locator('.notice')).toContainText('circular');
  await expect(page.locator('.trow').nth(0).locator('.td.pred')).toHaveText('');
});

test('summary rows roll up, indent, and colour their group', async ({ page }) => {
  await newSchedule(page, ['Phase', 'Task one', 'Task two']);
  await setDuration(page, 1, 3);
  await setDuration(page, 2, 4);

  await pickRow(page, 1);
  await page.keyboard.press('Alt+ArrowRight');
  await pickRow(page, 2);
  await page.keyboard.press('Alt+ArrowRight');

  await expect(page.locator('.trow.summary')).toHaveCount(1);
  await expect(page.locator('.sumbar')).toHaveCount(1);
  await expect(page.locator('.sumbar.g0')).toHaveCount(1);
  await expect(page.locator('.rail.g0')).toHaveCount(2);
  // The summary spans the longer of its two children.
  await expect(finishCell(page, 0)).toHaveText(await finishCell(page, 2).innerText());
});

test('milestones render as a diamond and survive a reload', async ({ page }) => {
  await newSchedule(page, ['A', 'Gate']);
  await pickRow(page, 1);
  await page.keyboard.press('m');
  await expect(page.locator('.ms')).toHaveCount(1);

  // Autosave is debounced; give it a beat before pulling the rug.
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.pitem').first().click();
  await expect(page.locator('.ms')).toHaveCount(1);
  await expect(page.locator('.trow')).toHaveCount(2);
});

test('critical path filter dims the slack', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 8);
  await expect(page.locator('.bar.critical')).toHaveCount(1);

  await page.getByRole('button', { name: 'Critical path' }).click();
  await expect(page.locator('.bar.dim')).toHaveCount(1);
});
