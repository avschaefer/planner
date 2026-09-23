import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });
test.setTimeout(90_000);

async function unlock(page: Page) {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Marga');
  await page.locator('#p').fill('local-dev-passcode');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.projects h1')).toHaveText('Marga', { timeout: 20_000 });
}

test('full stack: gate, shared write, live sync, editor lock', async ({ browser }) => {
  const a = await browser.newContext();
  const pageA = await a.newPage();

  // 1. The gate refuses a wrong passcode and accepts the right one.
  await pageA.goto('/');
  await pageA.locator('#p').fill('wrong');
  await pageA.locator('button[type=submit]').click();
  await expect(pageA.locator('#e')).toHaveText('That passcode is not right.');
  await unlock(pageA);

  // 2. Create a schedule; it is written through /api/save to Supabase.
  await pageA.getByPlaceholder('Name a new schedule…').fill('Two browser test');
  await pageA.getByPlaceholder('Name a new schedule…').press('Enter');
  await expect(pageA.locator('.toolbar .title')).toHaveText('Two browser test');

  await pageA.getByRole('button', { name: 'Add activity' }).first().click();
  for (const n of ['Design', 'Build']) {
    const input = pageA.locator('.trow input');
    await input.fill(n);
    await input.press('Enter');
  }
  await pageA.locator('.trow input').press('Escape');
  await expect(pageA.locator('.trow')).toHaveCount(2);
  await pageA.waitForTimeout(1200); // debounced save + lock claim

  // 3. A second browser sees it, and sees it live.
  const b = await browser.newContext();
  const pageB = await b.newPage();
  await unlock(pageB);
  await expect(pageB.locator('.pitem .name')).toContainText('Two browser test');
  await pageB.locator('.pitem').first().click();
  await expect(pageB.locator('.trow')).toHaveCount(2);

  // 4. B is read-only: A claimed the lock by editing.
  await expect(pageB.locator('.editing-banner')).toBeVisible({ timeout: 15_000 });
  console.log('B IS READ ONLY');

  // 5. A edits again; B sees it without a refresh.
  await pageA.getByRole('button', { name: 'Add activity' }).first().click();
  const input = pageA.locator('.trow input');
  await input.fill('Verify');
  await input.press('Enter');
  await pageA.locator('.trow input').press('Escape');
  await expect(pageA.locator('.trow')).toHaveCount(3);
  await expect(pageB.locator('.trow')).toHaveCount(3, { timeout: 20_000 });
  console.log('LIVE SYNC A -> B');

  // 6. B's edits are refused while A holds the lock.
  await pageB.locator('.trow').nth(0).locator('.td.code').click();
  await pageB.keyboard.press('m');
  await expect(pageB.locator('.notice')).toContainText('Take over', { timeout: 10_000 });
  await expect(pageB.locator('.ms')).toHaveCount(0);
  console.log('B EDIT REFUSED');

  // 7. B takes over; now B can edit and A cannot.
  await pageB.locator('.editing-banner button').click();
  await expect(pageB.locator('.editing-banner')).toHaveCount(0, { timeout: 10_000 });
  await pageB.locator('.trow').nth(0).locator('.td.code').click();
  await pageB.keyboard.press('m');
  await expect(pageB.locator('.ms')).toHaveCount(1, { timeout: 10_000 });
  console.log('B TOOK OVER AND EDITED');

  await expect(pageA.locator('.editing-banner')).toBeVisible({ timeout: 20_000 });
  console.log('A IS NOW READ ONLY');

  await a.close();
  await b.close();
});
