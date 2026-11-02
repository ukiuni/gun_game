import { expect } from '@playwright/test';

/** Open the game. `save` (optional) pre-seeds localStorage before the app boots. */
export async function openGame(page, { save = null, lang = 'ja', speed = 10 } = {}) {
  await page.addInitScript(([s, l]) => {
    if (sessionStorage.getItem('__seeded')) return; // only seed on the first load of the test
    sessionStorage.setItem('__seeded', '1');
    const base = {
      coins: 100, stage: 1, nextId: 5, guns: [1, 2, 3, 4].map((id) => ({ id, level: 1 })),
      layout: new Array(15).fill(null), lang: l, buys: 0, wins: 0, losses: 0, muted: true,
    };
    localStorage.setItem('gunmerge3d_save_v1', JSON.stringify({ ...base, ...(s || {}) }));
  }, [save, lang]);
  await page.goto(`/?speed=${speed}`);
  await expect(page.locator('#title')).toBeVisible();
  await page.waitForFunction(() => !!window.__game);
}

export async function toHome(page) {
  await page.locator('#btn-title-start').click();
  await expect(page.locator('#home')).toBeVisible();
}

export async function toSetup(page) {
  await toHome(page);
  await page.locator('#btn-play').click();
  await expect(page.locator('#setup')).toBeVisible();
  await page.waitForTimeout(150); // let the camera fit to the new layout
}

/** Tap a cell of the player's camp on the 3D board using real screen coordinates. */
export async function tapCell(page, idx) {
  const p = await page.evaluate((i) => window.__game.cellScreenPos('player', i), idx);
  await page.touchscreen.tap(p.x, p.y);
}

/** Drag a placed gun from one cell to another with the mouse pointer. */
export async function dragCell(page, from, to) {
  const a = await page.evaluate((i) => window.__game.cellScreenPos('player', i), from);
  const b = await page.evaluate((i) => window.__game.cellScreenPos('player', i), to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

export const layoutOf = (page) => page.evaluate(() => window.__game.save.layout);
export const gunsOf = (page) => page.evaluate(() => window.__game.save.guns);

export async function waitBattleEnd(page) {
  await page.waitForFunction(() => window.__game.battle && window.__game.battle.finished, null, { timeout: 80_000 });
  await expect(page.locator('#result')).toBeVisible();
}

/** layout helper: place gun ids into cells */
export function layout(map) {
  const l = new Array(15).fill(null);
  for (const [cell, id] of Object.entries(map)) l[+cell] = id;
  return l;
}
