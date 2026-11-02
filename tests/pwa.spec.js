// PWA tests: manifest, icons, service worker, offline play, install UI.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openGame, toHome, toSetup } from './helpers.js';
import { STRINGS } from '../src/i18n.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function pngSize(buf) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('マニフェストが正しく設定され、アイコンが取得できる', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('manifest.webmanifest');
  const res = await request.get(href);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.short_name).toBeTruthy();
  expect(['standalone', 'fullscreen']).toContain(m.display);
  expect(m.start_url.startsWith('./')).toBe(true); // relative: works under the GitHub Pages sub-path
  expect(m.scope).toBe('./');
  expect(m.background_color).toBeTruthy();
  expect(m.theme_color).toBeTruthy();
  const sizes = new Set(m.icons.map((i) => `${i.sizes}/${i.purpose}`));
  for (const s of ['192x192/any', '512x512/any', '192x192/maskable', '512x512/maskable']) expect(sizes.has(s), s).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    const { w, h } = pngSize(await r.body());
    expect(`${w}x${h}`).toBe(icon.sizes);
  }
  // iOS home-screen icon & meta
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const ar = await request.get(apple);
  expect(ar.ok()).toBe(true);
  expect(pngSize(await ar.body())).toEqual({ w: 180, h: 180 });
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
});

test('Service Worker のキャッシュ対象ファイルが全て存在し、ゲームに必要なファイルを網羅している', async ({}, info) => {
  test.skip(info.project.name !== 'android-pixel7', 'file check runs once');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const list = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  for (const f of list) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  const required = [
    ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`),
    ...fs.readdirSync(path.join(root, 'assets')).map((f) => `assets/${f}`),
    ...fs.readdirSync(path.join(root, 'icons')).map((f) => `icons/${f}`),
    'index.html', 'css/style.css', 'vendor/three.module.js', 'manifest.webmanifest',
  ];
  for (const f of required) expect(list, f).toContain(f);
});

test.describe('Service Worker / オフライン', () => {
  test.beforeEach(({ browserName }) => { test.skip(browserName !== 'chromium', 'Service Worker tests use Chromium'); });

  test('Service Worker が登録され、ページを制御する', async ({ page }) => {
    await page.goto('/');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('gunmerge3d-') && !k.endsWith('fonts')));
      return (await c.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(cached).toContain('/vendor/three.module.js');
    expect(cached).toContain('/src/main.js');
  });

  test('オフラインでも起動してプレイできる', async ({ page, context }) => {
    await openGame(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => !!window.__game);
    await expect(page.locator('#title')).toBeVisible();
    await toSetup(page);
    await page.locator('#btn-auto').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#battle')).toBeVisible();
    await page.waitForFunction(() => window.__game.battle.events.some((e) => e.type === 'attack'));
    await context.setOffline(false);
  });
});

test('インストール導線: Android はインストールボタン、iOS はホーム画面追加の案内', async ({ page, browserName }) => {
  await openGame(page);
  await toHome(page);
  if (browserName === 'webkit') {
    // iPhone / iPad Safari: no beforeinstallprompt -> show "Add to Home Screen" hint
    await expect(page.locator('#install-hint')).toBeVisible();
    await expect(page.locator('#install-hint')).toHaveText(STRINGS.ja.install_ios);
    await expect(page.locator('#btn-install')).toBeHidden();
  } else {
    // simulate Chrome's install prompt
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    await expect(page.locator('#btn-install')).toBeVisible();
    await expect(page.locator('#btn-install')).toHaveText(STRINGS.ja.install);
    await page.locator('#btn-install').click();
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator('#btn-install')).toBeHidden();
  }
});
