import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke coverage for the interactions that can't be unit tested: rendering,
 * quick-add, inline editing, bar dragging, link dragging, and undo.
 * The scheduling maths itself is covered by the Vitest fixtures.
 */

async function newSchedule(page: Page, names: string[]) {
  await page.goto('/');
  await page.getByPlaceholder('Name a new schedule…').fill('Smoke test');
  await page.getByPlaceholder('Name a new schedule…').press('Enter');
  await expect(page.locator('.toolbar .title')).toHaveText('Smoke test');

  await page.getByRole('button', { name: '+ Activity' }).click();
  for (const [i, name] of names.entries()) {
    const input = page.locator('.trow input');
    await input.fill(name);
    await input.press(i === names.length - 1 ? 'Escape' : 'Enter');
  }
  await expect(page.locator('.trow')).toHaveCount(names.length);
}

async function setDuration(page: Page, row: number, days: number) {
  await page.locator('.trow').nth(row).locator('.td.num').click();
  const input = page.locator('.trow').nth(row).locator('input');
  await input.fill(String(days));
  await input.press('Escape');
}

test('creates a schedule and adds activities with the keyboard', async ({ page }) => {
  await newSchedule(page, ['Design enclosure', 'Machine parts', 'Assemble']);
  await expect(page.locator('.trow').nth(0).locator('.tname .label')).toHaveText('Design enclosure');
  await expect(page.locator('.trow').nth(2).locator('.tname .label')).toHaveText('Assemble');
  await expect(page.locator('.bar')).toHaveCount(3);
});

test('duration edits change the finish date', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  const finishBefore = await page.locator('.trow').nth(0).locator('.td.date').nth(1).innerText();
  await setDuration(page, 0, 10);
  const finishAfter = await page.locator('.trow').nth(0).locator('.td.date').nth(1).innerText();
  expect(finishAfter).not.toBe(finishBefore);
  await expect(page.locator('.trow').nth(0).locator('.td.num')).toHaveText('10d');
});

test('a typed predecessor propagates and marks the chain critical', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 5);

  const startBefore = await page.locator('.trow').nth(1).locator('.td.date').first().innerText();
  await page.locator('.trow').nth(1).locator('.td.pred').click();
  const input = page.locator('.trow').nth(1).locator('input');
  await input.fill('A1000');
  await input.press('Escape');

  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('A1000');
  const startAfter = await page.locator('.trow').nth(1).locator('.td.date').first().innerText();
  expect(startAfter).not.toBe(startBefore);
  await expect(page.locator('.bar.critical')).toHaveCount(2);
});

test('lag shifts the successor', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await page.locator('.trow').nth(1).locator('.td.pred').click();
  let input = page.locator('.trow').nth(1).locator('input');
  await input.fill('A1000');
  await input.press('Escape');
  const before = await page.locator('.trow').nth(1).locator('.td.date').first().innerText();

  await page.locator('.trow').nth(1).locator('.td.pred').click();
  input = page.locator('.trow').nth(1).locator('input');
  await input.fill('A1000 FS+3d');
  await input.press('Escape');

  await expect(page.locator('.trow').nth(1).locator('.td.date').first()).not.toHaveText(before);
});

test('dragging a bar reschedules it, and undo puts it back', async ({ page }) => {
  await newSchedule(page, ['A']);
  const before = await page.locator('.trow').nth(0).locator('.td.date').first().innerText();

  const bar = page.locator('.bar').first();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 112, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = await page.locator('.trow').nth(0).locator('.td.date').first().innerText();
  expect(after).not.toBe(before);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.trow').nth(0).locator('.td.date').first()).toHaveText(before);
});

test('dragging the right edge changes duration', async ({ page }) => {
  await newSchedule(page, ['A']);
  await expect(page.locator('.trow').nth(0).locator('.td.num')).toHaveText('1d');

  const box = (await page.locator('.bar').first().boundingBox())!;
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 64, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const dur = await page.locator('.trow').nth(0).locator('.td.num').innerText();
  expect(Number(dur.replace('d', ''))).toBeGreaterThan(1);
});

test('dragging from the link handle creates a dependency', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await setDuration(page, 0, 4);

  const barA = page.locator('.bar').first();
  await barA.hover();
  const knob = page.locator('.knob').first();
  const kb = (await knob.boundingBox())!;
  const targetBox = (await page.locator('.bar').nth(1).boundingBox())!;

  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.trow').nth(1).locator('.td.pred')).toHaveText('A1000');
  await expect(page.locator('.link')).toHaveCount(1);
});

test('a circular link is refused', async ({ page }) => {
  await newSchedule(page, ['A', 'B']);
  await page.locator('.trow').nth(1).locator('.td.pred').click();
  let input = page.locator('.trow').nth(1).locator('input');
  await input.fill('A1000');
  await input.press('Escape');

  await page.locator('.trow').nth(0).locator('.td.pred').click();
  input = page.locator('.trow').nth(0).locator('input');
  await input.fill('A1010');
  await input.press('Escape');

  await expect(page.locator('.notice')).toContainText('circular');
  await expect(page.locator('.trow').nth(0).locator('.td.pred')).toHaveText('');
});

test('summary rows roll up and indenting works', async ({ page }) => {
  await newSchedule(page, ['Phase', 'Task one', 'Task two']);
  await setDuration(page, 1, 3);
  await setDuration(page, 2, 4);

  await page.locator('.trow').nth(1).click();
  await page.keyboard.press('Alt+ArrowRight');
  await page.locator('.trow').nth(2).click();
  await page.keyboard.press('Alt+ArrowRight');

  await expect(page.locator('.trow.summary')).toHaveCount(1);
  await expect(page.locator('.sumbar')).toHaveCount(1);
  // The summary spans the longer of its two children.
  await expect(page.locator('.trow').nth(0).locator('.td.date').nth(1)).toHaveText(
    await page.locator('.trow').nth(2).locator('.td.date').nth(1).innerText(),
  );
});

test('milestones render as a diamond and survive a reload', async ({ page }) => {
  await newSchedule(page, ['A', 'Gate']);
  await page.locator('.trow').nth(1).click();
  await page.keyboard.press('m');
  await expect(page.locator('.ms')).toHaveCount(1);

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
