import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accounts, end to end, against the real Supabase project. Not in the default
 * suite: run `npm run dev` (which reads .env.local) and then
 *   npx playwright test e2e/accounts.manual.spec.ts --config playwright.accounts.ts
 * A throwaway, pre-confirmed account is created and deleted around the run.
 */

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_][A-Z0-9_]*)=\"?(.*?)\"?$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]]),
);
const admin = createClient(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const email = `marga.e2e.${Date.now()}@example.com`;
const password = 'E2e-' + Math.random().toString(36).slice(2) + '!7';
let userId = '';

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Ada Tester' },
  });
  if (error) throw error;
  userId = data.user.id;
});
test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.locator('.auth-title')).toHaveText('Sign in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByPlaceholder('Name a new schedule…')).toBeVisible({ timeout: 15_000 });
}

test('accounts: sign in, persist, profile, editor lock, sign out', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await browser.newContext();
  const pageA = await a.newPage();

  // Wrong password is refused with a clear message.
  await pageA.goto('/');
  await pageA.getByLabel('Email').fill(email);
  await pageA.getByLabel('Password').fill('not-the-password');
  await pageA.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(pageA.locator('.auth-error')).toHaveText("That email and password don't match.");

  await signIn(pageA);
  await expect(pageA.locator('.avatar')).toHaveText('AT');
  await expect(pageA.locator('.empty')).toBeVisible(); // a new account sees no one else's schedules

  // Create a schedule with an activity; it is written through save_project.
  await pageA.getByPlaceholder('Name a new schedule…').fill('Accounts test');
  await pageA.getByPlaceholder('Name a new schedule…').press('Enter');
  await expect(pageA.locator('.toolbar .title')).toHaveText('Accounts test');
  await pageA.getByRole('button', { name: 'Add activity' }).click();
  await pageA.locator('.trow input').fill('Written as a real user');
  await pageA.locator('.trow input').press('Enter');
  await pageA.locator('.trow input').press('Escape');
  await pageA.waitForTimeout(1500);

  // Rename in place; the new name is what the list shows after the reload.
  await pageA.locator('.toolbar .title').click();
  await pageA.getByLabel('Schedule name').fill('Accounts test renamed');
  await pageA.getByLabel('Schedule name').press('Enter');
  await pageA.waitForTimeout(1500);

  // The session survives a reload: no sign-in screen, the work is there.
  await pageA.reload();
  await expect(pageA.locator('.pitem .name')).toHaveText('Accounts test renamed', { timeout: 15_000 });
  await expect(pageA.locator('.pitem .count')).toHaveText('1 activity');

  // Same account in a second browser: sees the schedule, and is read-only
  // while the first holds the editor lock.
  await pageA.locator('.pitem').first().click();
  await pageA.locator('.trow').first().locator('.td.dur').click();
  await pageA.locator('.trow').first().locator('input').fill('4');
  await pageA.locator('.trow').first().locator('input').press('Enter');
  await pageA.waitForTimeout(1500);

  const b = await browser.newContext();
  const pageB = await b.newPage();
  await signIn(pageB);
  await pageB.locator('.pitem').first().click();
  await expect(pageB.locator('.editing-banner')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.locator('.trow').first().locator('.td.dur')).toHaveText('4d');

  // A's next edit arrives in B live.
  await pageA.locator('.trow').first().locator('.td.dur').click();
  await pageA.locator('.trow').first().locator('input').fill('6');
  await pageA.locator('.trow').first().locator('input').press('Enter');
  await expect(pageB.locator('.trow').first().locator('.td.dur')).toHaveText('6d', { timeout: 15_000 });
  await b.close();

  // Profile: rename, and the avatar follows.
  await pageA.locator('.toolbar button[title="All schedules"]').click();
  await pageA.locator('.avatar').click();
  await expect(pageA.locator('.account-title')).toHaveText('Account');
  await expect(pageA.locator('.auth-readonly').first()).toHaveText(email);
  await expect(pageA.locator('.auth-readonly').nth(1)).toHaveText('Free');
  await pageA.getByLabel('Name').fill('Grace Hopper');
  await pageA.getByRole('button', { name: 'Save name' }).click();
  await expect(pageA.locator('.notice')).toHaveText('Name saved.');
  await pageA.getByRole('button', { name: 'Schedules' }).click();
  await expect(pageA.locator('.avatar')).toHaveText('GH');

  // Sign out returns to the sign-in screen, and stays there on reload.
  await pageA.locator('.avatar').click();
  await pageA.getByRole('button', { name: 'Sign out' }).click();
  await expect(pageA.locator('.auth-title')).toHaveText('Sign in');
  await pageA.reload();
  await expect(pageA.locator('.auth-title')).toHaveText('Sign in', { timeout: 15_000 });
  await a.close();
});
