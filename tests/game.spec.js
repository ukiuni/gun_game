// End-to-end tests of the browser game (run on Android / iPhone / iPad emulation).
import { test, expect } from '@playwright/test';
import { openGame, toHome, toSetup, tapCell, dragCell, layoutOf, gunsOf, waitBattleEnd, layout } from './helpers.js';
import { STRINGS, LANGS } from '../src/i18n.js';
import { AIM_TOLERANCE, EXPLODE_TIME } from '../src/battle.js';
import { coinReward } from '../src/gunstats.js';

const JA = STRINGS.ja;

test.describe('画面遷移', () => {
  test('タイトル画面からホーム画面に移動できる', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#title img.logo')).toBeVisible();
    await expect(page.locator('#btn-title-start')).toHaveText(JA.tap_to_start);
    await page.locator('#btn-title-start').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#title')).toBeHidden();
    expect(await page.evaluate(() => window.__game.screen)).toBe('home');
  });

  test('ホーム画面で保持している銃とコインを確認でき、コインで銃を追加できる', async ({ page }) => {
    await openGame(page, { save: { coins: 250, guns: [{ id: 1, level: 1 }, { id: 2, level: 12 }, { id: 3, level: 1000 }], nextId: 4 } });
    await toHome(page);
    await expect(page.locator('#home-coins')).toHaveText('250');
    const cards = page.locator('#home-guns .gun-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Lv.1000');
    await expect(cards.nth(0)).toContainText('MAX');
    await expect(cards.nth(1)).toContainText('Lv.12');
    await expect(cards.nth(2)).toContainText('Lv.1');
    await expect(page.locator('#home-gun-count')).toHaveText('3 丁');
    // add a gun with coins
    const price = Number(await page.locator('#btn-buy').getAttribute('data-price'));
    await page.locator('#btn-buy').click();
    await expect(cards).toHaveCount(4);
    await expect(page.locator('#home-coins')).toHaveText(String(250 - price));
    expect((await gunsOf(page)).length).toBe(4);
  });

  test('ホーム画面からゲームスタートできる', async ({ page }) => {
    await openGame(page);
    await toHome(page);
    await expect(page.locator('#btn-play')).toHaveText(JA.play);
    await page.locator('#btn-play').click();
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#setup-title')).toHaveText(JA.setup_title.replace('{stage}', '1'));
    await expect(page.locator('#tray .gun-card')).toHaveCount(4);
  });
});

test.describe('配置と合体', () => {
  test('各種銃を自陣のマスに配置できる', async ({ page }) => {
    await openGame(page, { save: { guns: [{ id: 1, level: 1 }, { id: 2, level: 15 }, { id: 3, level: 60 }], nextId: 4 } });
    await toSetup(page);
    const tray = page.locator('#tray .gun-card');
    await expect(tray).toHaveCount(3);
    // place each kind (rank C, B, A) on a different cell by tap -> tap
    const targets = { 3: 2, 2: 6, 1: 13 };
    for (const [id, cell] of Object.entries(targets)) {
      await page.locator(`#tray .gun-card[data-gun-id="${id}"]`).click();
      await expect(page.locator(`#tray .gun-card[data-gun-id="${id}"]`)).toHaveClass(/selected/);
      await tapCell(page, cell);
      await expect(page.locator(`#tray .gun-card[data-gun-id="${id}"]`)).toHaveCount(0);
    }
    const l = await layoutOf(page);
    expect(l[2]).toBe(3);
    expect(l[6]).toBe(2);
    expect(l[13]).toBe(1);
    await expect(page.locator('#tray .tray-empty')).toBeVisible();
    // the 3D board shows the placed guns
    const meshes = await page.evaluate(() => [...window.__game.scene.gunMeshes.keys()].filter((k) => k.startsWith('player')).sort());
    expect(meshes).toEqual(['player-1', 'player-2', 'player-3']);
    // move a placed gun by dragging it to an empty cell
    await dragCell(page, 13, 9);
    const l2 = await layoutOf(page);
    expect(l2[13]).toBeNull();
    expect(l2[9]).toBe(1);
    // remove a gun back to the tray
    await tapCell(page, 9);
    await expect(page.locator('#btn-unplace')).toBeEnabled();
    await page.locator('#btn-unplace').click();
    await expect(page.locator('#tray .gun-card[data-gun-id="1"]')).toHaveCount(1);
  });

  test('同じランクの銃を同じマスに重ねると合体してパワーアップする', async ({ page }) => {
    await openGame(page, { save: { guns: [{ id: 1, level: 1 }, { id: 2, level: 1 }, { id: 3, level: 2 }, { id: 4, level: 30 }], nextId: 5 } });
    await toSetup(page);
    // tray -> cell, then another tray gun onto the same cell => merge
    await page.locator('#tray .gun-card[data-gun-id="1"]').click();
    await tapCell(page, 7);
    await page.locator('#tray .gun-card[data-gun-id="2"]').click();
    await tapCell(page, 7);
    await expect(page.locator('#toast')).toHaveText(JA.merged.replace('{level}', '2'));
    let guns = await gunsOf(page);
    expect(guns.length).toBe(3);
    expect(guns.find((g) => g.id === 1).level).toBe(2);
    expect((await layoutOf(page))[7]).toBe(1);

    // board -> board merge by dragging: place id3 (Lv2) on cell 0 and drag onto cell 7 (Lv2)
    await page.locator('#tray .gun-card[data-gun-id="3"]').click();
    await tapCell(page, 0);
    await dragCell(page, 0, 7);
    guns = await gunsOf(page);
    expect(guns.length).toBe(2);
    expect(guns.find((g) => g.id === 1).level).toBe(4);
    const l = await layoutOf(page);
    expect(l[0]).toBeNull();
    expect(l[7]).toBe(1);
    // label of the 3D gun reflects the new level
    expect(await page.evaluate(() => window.__game.scene.gunMeshes.get('player-1').userData.level)).toBe(4);

    // different rank (Lv30 = rank B vs Lv4 = rank C) does NOT merge -> swap
    await page.locator('#tray .gun-card[data-gun-id="4"]').click();
    await tapCell(page, 7);
    await expect(page.locator('#toast')).toHaveText(JA.swapped);
    guns = await gunsOf(page);
    expect(guns.length).toBe(2);
    expect((await layoutOf(page))[7]).toBe(4);
    // merges are permanent (saved)
    await page.reload();
    await page.waitForFunction(() => !!window.__game);
    expect((await gunsOf(page)).find((g) => g.id === 1).level).toBe(4);
  });

  test('レベルは最大1000まで（1000段階）', async ({ page }) => {
    await openGame(page, { save: { guns: [{ id: 1, level: 700 }, { id: 2, level: 900 }, { id: 3, level: 1000 }, { id: 4, level: 1000 }], nextId: 5 } });
    await toSetup(page);
    await page.locator('#tray .gun-card[data-gun-id="1"]').click();
    await tapCell(page, 0);
    await page.locator('#tray .gun-card[data-gun-id="2"]').click();
    await tapCell(page, 0);
    expect((await gunsOf(page)).find((g) => g.id === 1).level).toBe(1000); // 700+900 capped
    await page.locator('#tray .gun-card[data-gun-id="3"]').click();
    await tapCell(page, 1);
    await page.locator('#tray .gun-card[data-gun-id="4"]').click();
    await tapCell(page, 1);
    await expect(page.locator('#toast')).toHaveText(JA.max_level);
    expect((await gunsOf(page)).length).toBe(3);
  });
});

test.describe('バトル', () => {
  async function startDefaultBattle(page, save, speed = 10) {
    await openGame(page, { save, speed });
    await toSetup(page);
    if ((await page.locator('#tray .gun-card').count()) > 0) await page.locator('#btn-auto').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#battle')).toBeVisible();
  }

  test('スタートボタンでゲームを開始できる（未配置では開始不可）', async ({ page }) => {
    await openGame(page, { speed: 1 });
    await toSetup(page);
    await expect(page.locator('#btn-start')).toBeDisabled();
    await page.locator('#btn-auto').click();
    await expect(page.locator('#btn-start')).toBeEnabled();
    await page.locator('#btn-start').click();
    await expect(page.locator('#battle')).toBeVisible();
    expect(await page.evaluate(() => window.__game.screen)).toBe('battle');
    const counts = await page.evaluate(() => ({ p: window.__game.battle.present('player').length, e: window.__game.battle.present('enemy').length }));
    expect(counts.p).toBe(4);
    expect(counts.e).toBeGreaterThan(0);
    await expect(page.locator('#hud-player')).toHaveText('4');
  });

  test('開始すると自分と敵の銃が戦いを始める', async ({ page }) => {
    await startDefaultBattle(page);
    await page.waitForFunction(() => {
      const ev = window.__game.battle.events;
      return ev.some((e) => e.type === 'attack' && e.team === 'player') && ev.some((e) => e.type === 'attack' && e.team === 'enemy');
    });
  });

  test('銃口を敵に向けて回転し、向いたら攻撃モーションを取り攻撃する', async ({ page }) => {
    await startDefaultBattle(page, undefined, 1); // real-time so the recoil frames are rendered
    // the attack motion (barrel recoil + muzzle flash) is visible on the 3D model
    await page.waitForFunction(() => {
      for (const g of window.__game.scene.gunMeshes.values()) {
        if (g.userData.barrels.position.z < -0.02 && g.userData.muzzle.visible) return true;
      }
      return false;
    });
    await page.waitForFunction(() => window.__game.battle.events.filter((e) => e.type === 'attack').length >= 6);
    const r = await page.evaluate(() => {
      const b = window.__game.battle;
      const ev = b.events;
      return {
        attacks: ev.filter((e) => e.type === 'attack'),
        rotates: ev.filter((e) => e.type === 'rotate'),
        aimed: ev.filter((e) => e.type === 'aimed'),
        guns: b.guns.map((g) => ({ uid: g.uid, team: g.team, totalRotation: g.totalRotation, initialYaw: g.initialYaw, x: g.x, z: g.z })),
      };
    });
    for (const a of r.attacks) {
      // fired only when the barrel faces the target
      expect(a.yawError).toBeLessThanOrEqual(AIM_TOLERANCE + 1e-9);
      // the gun had rotated toward the target before its first shot
      const firstRotate = r.rotates.find((x) => x.gun === a.attacker);
      expect(firstRotate, `rotate before attack of ${a.attacker}`).toBeTruthy();
      expect(firstRotate.t).toBeLessThanOrEqual(a.t);
      const aimed = r.aimed.find((x) => x.gun === a.attacker && x.t <= a.t);
      expect(aimed).toBeTruthy();
      expect(a.target.split('-')[0]).not.toBe(a.team); // aims at the opposing side
    }
    const attackers = new Set(r.attacks.map((a) => a.attacker));
    for (const uid of attackers) expect(r.guns.find((g) => g.uid === uid).totalRotation).toBeGreaterThan(0);
    // both player guns and enemy guns attacked
    expect(r.attacks.some((a) => a.team === 'player')).toBe(true);
    expect(r.attacks.some((a) => a.team === 'enemy')).toBe(true);
  });

  test('パワーアップに応じて弾丸の形・大きさ・個数が変わり、砲身の数だけ同時に発射される', async ({ page }) => {
    // Lv1 (rank C, 1 barrel), Lv50 (rank A, 2 barrels), Lv350 (rank SS, 3 barrels)
    await startDefaultBattle(page, {
      guns: [{ id: 1, level: 1 }, { id: 2, level: 50 }, { id: 3, level: 350 }], nextId: 4,
      layout: layout({ 1: 1, 2: 2, 3: 3 }), stage: 6,
    }, 1);
    const expected = { 'player-1': { n: 1, shape: 'pellet' }, 'player-2': { n: 2, shape: 'orb' }, 'player-3': { n: 3, shape: 'missile' } };
    // the 3D models have that many barrels
    const barrels = await page.evaluate(() => Object.fromEntries(['player-1', 'player-2', 'player-3'].map((k) => {
      const m = window.__game.scene.gunMeshes.get(k);
      return [k, m.userData.barrels.children.filter((c) => c.geometry.parameters.depth > 0.3).length];
    })));
    for (const [k, v] of Object.entries(expected)) expect(barrels[k]).toBe(v.n);

    // every gun is seen firing a full volley: n bullets of its own shape on screen at the same time
    const seen = await page.evaluate(async (exp) => {
      const found = {};
      const t0 = performance.now();
      while (Object.keys(found).length < 3 && performance.now() - t0 < 20000) {
        await new Promise((r) => requestAnimationFrame(r));
        const groups = {};
        for (const m of window.__game.scene.projMeshes.values()) {
          const key = `${m.userData.owner}#${m.userData.volley}`;
          (groups[key] ||= []).push({ shape: m.userData.shape, size: m.userData.size });
        }
        for (const [key, list] of Object.entries(groups)) {
          const owner = key.split('#')[0];
          if (exp[owner] && !found[owner] && list.length === exp[owner].n) found[owner] = list;
        }
      }
      return found;
    }, expected);
    for (const [k, v] of Object.entries(expected)) {
      expect(seen[k], `volley of ${k}`).toBeTruthy();
      expect(seen[k].length).toBe(v.n);
      for (const b of seen[k]) expect(b.shape).toBe(v.shape);
    }
    // bigger guns fire bigger bullets
    expect(seen['player-2'][0].size).toBeGreaterThan(seen['player-1'][0].size);
    expect(seen['player-3'][0].size).toBeGreaterThan(seen['player-2'][0].size);
    // attack events report the bullet count
    const ev = await page.evaluate(() => window.__game.battle.events.filter((e) => e.type === 'attack' && e.team === 'player'));
    for (const e of ev) expect(e.bulletCount).toBe(expected[e.attacker].n);
  });

  test('味方同士の攻撃はダメージを与えない', async ({ page }) => {
    // back-row gun shoots straight through the front-row ally
    await startDefaultBattle(page, { guns: [{ id: 1, level: 3 }, { id: 2, level: 3 }, { id: 3, level: 3 }], nextId: 4, layout: layout({ 2: 1, 7: 2, 12: 3 }) }, 1);
    // direct check of the damage rule (own vs own / enemy vs enemy)
    const direct = await page.evaluate(() => {
      const b = window.__game.battle;
      const p = b.guns.filter((g) => g.team === 'player');
      const e = b.guns.filter((g) => g.team === 'enemy');
      const hp1 = p[1].hp;
      const out = { pp: b.applyHit(p[0], p[1], 50), ppHp: p[1].hp === hp1 };
      if (e.length > 1) { const hp2 = e[1].hp; out.ee = b.applyHit(e[0], e[1], 50); out.eeHp = e[1].hp === hp2; }
      window.__game.setSpeed(10);
      return out;
    });
    expect(direct.pp).toBe(0);
    expect(direct.ppHp).toBe(true);
    if ('ee' in direct) { expect(direct.ee).toBe(0); expect(direct.eeHp).toBe(true); }
    await waitBattleEnd(page);
    const r = await page.evaluate(() => {
      const ev = window.__game.battle.events;
      return { damage: ev.filter((e) => e.type === 'damage'), passes: ev.filter((e) => e.type === 'friendlyPass') };
    });
    // every damage event is between opposite teams
    for (const d of r.damage) expect(d.attacker.split('-')[0]).not.toBe(d.target.split('-')[0]);
    // bullets that went through an ally did not change its HP
    expect(r.passes.length).toBeGreaterThan(0);
    for (const p of r.passes) { expect(p.dealt).toBe(0); expect(p.hpAfter).toBe(p.hpBefore); }
  });

  test('攻撃が当たるとHPが減る（HPバーも減る）', async ({ page }) => {
    await startDefaultBattle(page);
    await page.waitForFunction(() => window.__game.battle.events.some((e) => e.type === 'damage'));
    const r = await page.evaluate(() => {
      const b = window.__game.battle;
      const d = b.events.find((e) => e.type === 'damage');
      const g = b.get(d.target);
      const mesh = window.__game.scene.gunMeshes.get(d.target);
      return { d, hp: g.hp, maxHp: g.maxHp, bar: mesh ? mesh.userData.hpFg.scale.x : null };
    });
    expect(r.d.hpAfter).toBeLessThan(r.d.hpBefore);
    expect(r.d.amount).toBeGreaterThan(0);
    expect(r.hp).toBeLessThan(r.maxHp);
    if (r.bar !== null) expect(r.bar).toBeLessThan(0.78);
  });

  test('HPが0になると爆発モーションの後に銃が消える', async ({ page }) => {
    await startDefaultBattle(page);
    await page.waitForFunction(() => window.__game.battle.events.some((e) => e.type === 'destroyed'));
    const first = await page.evaluate(() => {
      const b = window.__game.battle;
      const d = b.events.find((e) => e.type === 'destroyed');
      const g = b.get(d.target);
      const mesh = window.__game.scene.gunMeshes.get(d.target);
      return { d, hp: g.hp, state: g.state, meshExists: !!mesh };
    });
    expect(first.hp).toBe(0);
    // explosion motion is playing: gun still on the board, an explosion effect exists
    if (first.state === 'dying') {
      expect(first.meshExists).toBe(true);
      await page.waitForFunction((uid) => {
        const m = window.__game.scene.gunMeshes.get(uid);
        return (m && m.userData.exploding) || window.__game.battle.get(uid).state === 'removed';
      }, first.d.target);
    }
    await page.waitForFunction((uid) => window.__game.battle.get(uid).state === 'removed', first.d.target);
    const after = await page.evaluate((uid) => {
      const b = window.__game.battle;
      const rm = b.events.find((e) => e.type === 'removed' && e.target === uid);
      return { rm, meshExists: window.__game.scene.gunMeshes.has(uid) };
    }, first.d.target);
    expect(after.rm.t - first.d.t).toBeGreaterThanOrEqual(EXPLODE_TIME - 0.02);
    await page.waitForTimeout(100);
    expect(await page.evaluate((uid) => window.__game.scene.gunMeshes.has(uid), first.d.target)).toBe(false);
  });

  test('どちらかの銃がすべて消えるとゲームが終了する', async ({ page }) => {
    await startDefaultBattle(page);
    await waitBattleEnd(page);
    const r = await page.evaluate(() => {
      const b = window.__game.battle;
      return { end: b.events.find((e) => e.type === 'end'), p: b.present('player').length, e: b.present('enemy').length, finished: b.finished };
    });
    expect(r.finished).toBe(true);
    expect(r.p === 0 || r.e === 0).toBe(true);
    expect(r.end).toBeTruthy();
    // nothing happens after the end
    const n = await page.evaluate(() => window.__game.battle.events.length);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__game.battle.events.length)).toBe(n);
  });
});

test.describe('勝敗とステージ', () => {
  const strong = { coins: 100, guns: [{ id: 1, level: 80 }, { id: 2, level: 80 }], nextId: 3, layout: layout({ 1: 1, 3: 2 }) };
  const weak = { coins: 100, stage: 25, guns: [{ id: 1, level: 1 }], nextId: 2, layout: layout({ 2: 1 }) };

  async function play(page, save) {
    await openGame(page, { save });
    await toSetup(page);
    await page.locator('#btn-start').click();
    await waitBattleEnd(page);
  }

  test('自分の銃が残れば勝利画面がオーバーレイし、次のステージへ進める', async ({ page }) => {
    await play(page, strong);
    await expect(page.locator('#result')).toHaveAttribute('data-result', 'victory');
    await expect(page.locator('#result-title')).toHaveText(JA.victory);
    expect(await page.evaluate(() => window.__game.battle.present('player').length)).toBeGreaterThan(0);
    await expect(page.locator('#battle')).toBeVisible(); // overlay on top of the battlefield
    await expect(page.locator('#btn-next')).toBeVisible();
    await expect(page.locator('#btn-retry')).toBeHidden();
    await page.locator('#btn-next').click();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#setup-title')).toHaveText(JA.setup_title.replace('{stage}', '2'));
    expect(await page.evaluate(() => window.__game.save.stage)).toBe(2);
  });

  test('敵の銃が残れば敗北画面がオーバーレイし、リトライできる', async ({ page }) => {
    await play(page, weak);
    await expect(page.locator('#result')).toHaveAttribute('data-result', 'defeat');
    await expect(page.locator('#result-title')).toHaveText(JA.defeat);
    expect(await page.evaluate(() => window.__game.battle.present('enemy').length)).toBeGreaterThan(0);
    await expect(page.locator('#btn-retry')).toBeVisible();
    await expect(page.locator('#btn-next')).toBeHidden();
    await page.locator('#btn-retry').click();
    await expect(page.locator('#setup')).toBeVisible();
    await expect(page.locator('#setup-title')).toHaveText(JA.setup_title.replace('{stage}', '25'));
    // can play again
    await page.locator('#btn-start').click();
    await expect(page.locator('#battle')).toBeVisible();
  });

  test('勝利画面からホーム画面に移動できる', async ({ page }) => {
    await play(page, strong);
    await page.locator('#btn-result-home').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#home-stage')).toHaveText('2');
  });

  test('敗北画面からホーム画面に移動できる', async ({ page }) => {
    await play(page, weak);
    await page.locator('#btn-result-home').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#home-stage')).toHaveText('25');
  });

  test('勝利すると多いコイン、敗北すると少ないコインを獲得する', async ({ page }) => {
    await play(page, strong); // stage 1 victory
    const win = await page.evaluate(() => window.__game.save.coins - 100);
    expect(win).toBe(coinReward(1, true));
    await expect(page.locator('#result-coins')).toHaveText(JA.coins_earned.replace('{n}', String(win)));
    await page.locator('#btn-result-home').click();
    await expect(page.locator('#home-coins')).toHaveText(String(100 + win));

    const page2 = await page.context().newPage(); // fresh page, seeded with its own save
    await play(page2, weak); // stage 25 defeat
    await expect(page2.locator('#result')).toHaveAttribute('data-result', 'defeat');
    const lose = await page2.evaluate(() => window.__game.save.coins - 100);
    expect(lose).toBe(coinReward(25, false));
    await expect(page2.locator('#result-coins')).toHaveText(JA.coins_earned.replace('{n}', String(lose)));
    expect(lose).toBeGreaterThan(0);
    expect(win).toBeGreaterThan(lose); // even a stage-1 win pays more than a stage-25 loss
  });
});

test.describe('多言語対応', () => {
  test('言語を切り替えると表示が変わり、保存される', async ({ page }) => {
    await openGame(page, { lang: 'ja' });
    await expect(page.locator('#btn-title-start')).toHaveText(STRINGS.ja.tap_to_start);
    for (const code of Object.keys(LANGS)) {
      await page.locator('#lang-title').selectOption(code);
      await expect(page.locator('#btn-title-start')).toHaveText(STRINGS[code].tap_to_start);
      await expect(page.locator('#title .subtitle')).toHaveText(STRINGS[code].subtitle);
    }
    await page.locator('#lang-title').selectOption('en');
    await toHome(page);
    await expect(page.locator('#btn-play')).toHaveText(STRINGS.en.play);
    await expect(page.locator('#lang-home')).toHaveValue('en');
    await page.locator('#lang-home').selectOption('ko');
    await expect(page.locator('#btn-play')).toHaveText(STRINGS.ko.play);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await page.reload();
    await page.waitForFunction(() => !!window.__game);
    await expect(page.locator('#btn-title-start')).toHaveText(STRINGS.ko.tap_to_start);
  });

  test('全言語で全ての文言キーが翻訳されている', async () => {
    const keys = Object.keys(STRINGS.ja);
    for (const code of Object.keys(LANGS)) {
      for (const k of keys) expect(STRINGS[code][k], `${code}.${k}`).toBeTruthy();
    }
  });

  test('ブラウザの言語から自動判定される', async ({ browser }) => {
    for (const [locale, expected] of [['ja-JP', 'ja'], ['en-US', 'en'], ['zh-CN', 'zh'], ['ko-KR', 'ko'], ['es-ES', 'es']]) {
      const ctx = await browser.newContext({ locale });
      const p = await ctx.newPage();
      await p.goto('/');
      await p.waitForFunction(() => !!window.__game);
      expect(await p.evaluate(() => window.__game.getLang())).toBe(expected);
      await expect(p.locator('#btn-title-start')).toHaveText(STRINGS[expected].tap_to_start);
      await ctx.close();
    }
  });
});

test.describe('モバイル', () => {
  test('横スクロールが発生せず、主要ボタンが画面内に収まる', async ({ page }) => {
    await openGame(page);
    await toSetup(page);
    const vw = page.viewportSize().width;
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(vw);
    for (const sel of ['#btn-start', '#btn-auto', '#btn-setup-back']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
    // every player cell is on screen and not hidden behind the HUD
    const vh = page.viewportSize().height;
    const trayTop = (await page.locator('.setup-bottom').boundingBox()).y;
    const topBottom = await page.locator('.setup-top').evaluate((e) => e.getBoundingClientRect().bottom);
    for (let i = 0; i < 15; i++) {
      const p = await page.evaluate((k) => window.__game.cellScreenPos('player', k), i);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(vw);
      expect(p.y).toBeGreaterThan(topBottom);
      expect(p.y).toBeLessThan(Math.min(vh, trayTop));
    }
  });
});
