// Auto battle: after a victory the next stage starts automatically, until the first defeat.
import { test, expect } from '@playwright/test';
import { openGame, toSetup, layout } from './helpers.js';
import { STRINGS } from '../src/i18n.js';

const JA = STRINGS.ja;
// One Lv8 gun: wins the first few stages, then loses (stage 4 in simulation).
const chain = { coins: 100, stage: 1, guns: [{ id: 1, level: 8 }], nextId: 2, layout: layout({ 2: 1 }) };
const strong = { coins: 100, stage: 1, guns: [{ id: 1, level: 80 }, { id: 2, level: 80 }], nextId: 3, layout: layout({ 1: 1, 3: 2 }) };

/** Wait for a battle result and read it atomically (the auto countdown may clear it right after). */
async function waitResult(page) {
  const h = await page.waitForFunction(() => window.__game.result && { ...window.__game.result }, null, { timeout: 120_000 });
  return h.jsonValue();
}

test('配置画面で自動連戦をON/OFFでき、設定が保存される', async ({ page }) => {
  await openGame(page);
  await toSetup(page);
  const btn = page.locator('#btn-auto-battle');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toContainText(JA.auto_battle);
  await expect(page.locator('#auto-battle-state')).toHaveText(JA.off);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#auto-battle-state')).toHaveText(JA.on);
  expect(await page.evaluate(() => window.__game.save.autoBattle)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await toSetup(page);
  await expect(page.locator('#btn-auto-battle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-auto-battle').click();
  await expect(page.locator('#btn-auto-battle')).toHaveAttribute('aria-pressed', 'false');
});

test('自動連戦ON: 勝利すると自動で次のステージが始まり、負けるまで続く', async ({ page }) => {
  test.setTimeout(240_000);
  await openGame(page, { save: { ...chain, autoBattle: true } });
  await page.evaluate(() => window.__game.setAutoDelay(1500));
  await toSetup(page);
  await page.locator('#btn-start').click(); // the only manual action in this test
  await expect(page.locator('#battle')).toBeVisible();
  await expect(page.locator('#auto-badge')).toBeVisible();
  await expect(page.locator('#btn-auto-stop')).toBeVisible();

  // first victory: the countdown panel is shown, then the next stage starts by itself
  const first = await waitResult(page);
  expect(first.win).toBe(true);
  await expect(page.locator('#auto-panel')).toBeVisible();
  await expect(page.locator('#auto-countdown')).toContainText(JA.auto_next.split('{s}')[1]);
  await page.waitForFunction(() => window.__game.attempts >= 2, null, { timeout: 30_000 });

  // ...and it keeps going until the first defeat
  await page.waitForFunction(() => window.__game.resultsLog.some((r) => !r.win), null, { timeout: 200_000 });
  const log = await page.evaluate(() => window.__game.resultsLog);
  const wins = log.filter((r) => r.win).length;
  expect(wins).toBeGreaterThanOrEqual(2); // continued automatically at least twice
  expect(log.at(-1).win).toBe(false); // stopped at the defeat
  log.forEach((r, i) => {
    expect(r.stage).toBe(1 + i); // stage 1, 2, 3, ... in order, no retries
    expect(r.attempt).toBe(1 + i); // one battle per stage, each started automatically
    expect(r.auto).toBe(true);
  });
  expect(log.at(-2).streak).toBe(wins);

  // defeat overlay: auto battle ended, nothing restarts
  await expect(page.locator('#result')).toHaveAttribute('data-result', 'defeat');
  await expect(page.locator('#auto-panel')).toBeHidden();
  await expect(page.locator('#auto-ended')).toHaveText(JA.auto_ended.replace('{n}', String(wins)));
  await expect(page.locator('#btn-retry')).toBeVisible();
  const coins = await page.evaluate(() => window.__game.save.coins);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__game.attempts)).toBe(log.length);
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(() => window.__game.save.coins)).toBe(coins);
  expect(await page.evaluate(() => window.__game.save.stage)).toBe(1 + wins);
});

test('勝利画面のカウントダウン中に「自動連戦を止める」で停止できる', async ({ page }) => {
  await openGame(page, { save: { ...strong, autoBattle: true } });
  await page.evaluate(() => window.__game.setAutoDelay(8000)); // long enough to press the button
  await toSetup(page);
  await page.locator('#btn-start').click();
  const r = await waitResult(page);
  expect(r.win).toBe(true);
  await expect(page.locator('#auto-panel')).toBeVisible();
  await page.locator('#btn-auto-cancel').click();
  await expect(page.locator('#auto-panel')).toBeHidden();
  expect(await page.evaluate(() => window.__game.autoCountdownActive)).toBe(false);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__game.result?.win)).toBe(true); // still on the victory overlay
  expect(await page.evaluate(() => window.__game.attempts)).toBe(1);
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(() => window.__game.save.autoBattle)).toBe(false);
  // manual "next stage" still works
  await page.locator('#btn-next').click();
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#btn-auto-battle')).toHaveAttribute('aria-pressed', 'false');
});

test('バトル中の「自動連戦を止める」で、勝利後に自動で進まなくなる', async ({ page }) => {
  await openGame(page, { save: { ...strong, autoBattle: true }, speed: 1 });
  await toSetup(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-auto-stop')).toBeVisible();
  await page.locator('#btn-auto-stop').click();
  await expect(page.locator('#btn-auto-stop')).toBeHidden();
  await expect(page.locator('#auto-badge')).toBeHidden();
  await page.evaluate(() => window.__game.setSpeed(10));
  const r = await waitResult(page);
  expect(r.win).toBe(true);
  await expect(page.locator('#auto-panel')).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(() => window.__game.save.stage)).toBe(2);
});

test('自動連戦OFFでは勝利しても自動で進まない', async ({ page }) => {
  await openGame(page, { save: { ...strong, autoBattle: false } });
  await toSetup(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#auto-badge')).toBeHidden();
  const r = await waitResult(page);
  expect(r.win).toBe(true);
  await expect(page.locator('#auto-panel')).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(() => window.__game.screen)).toBe('battle');
});
