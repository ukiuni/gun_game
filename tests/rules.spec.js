// Pure logic tests for game rules and the battle simulation (no browser needed).
import { test, expect } from '@playwright/test';
import {
  rankOf, canMerge, mergedLevel, MAX_LEVEL, statsOf, enemyLevelsForStage, enemyStatMultiplier, coinReward, enemyCellsForStage,
  gunDesign, barrelCount, BULLET_SHAPES,
} from '../src/gunstats.js';
import { Battle, AIM_TOLERANCE, EXPLODE_TIME, wrapAngle, yawTo } from '../src/battle.js';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'android-pixel7', 'logic tests run once'); });

function run(b, maxT = 300) {
  while (!b.finished && b.time < maxT) b.step(1 / 60);
  return b;
}

test('ランク: 同ランクのみ合体でき、レベルは合計(最大1000)', () => {
  expect(rankOf(1)).toBe(1);
  expect(rankOf(10)).toBe(2);
  expect(rankOf(1000)).toBe(7);
  expect(canMerge({ id: 1, level: 3 }, { id: 2, level: 5 })).toBe(true);
  expect(canMerge({ id: 1, level: 9 }, { id: 2, level: 10 })).toBe(false);
  expect(canMerge({ id: 1, level: 1000 }, { id: 2, level: 1000 })).toBe(false);
  expect(mergedLevel({ level: 600 }, { level: 650 })).toBe(MAX_LEVEL);
  // all 1000 levels are distinct power-ups
  for (let l = 2; l <= MAX_LEVEL; l++) {
    expect(statsOf(l).maxHp).toBeGreaterThan(statsOf(l - 1).maxHp);
    expect(statsOf(l).atk).toBeGreaterThan(statsOf(l - 1).atk);
  }
});

test('ステージを進むごとに敵が強くなる', () => {
  const power = (s) => enemyLevelsForStage(s).reduce((a, l) => a + statsOf(l).maxHp * statsOf(l).atk, 0) * enemyStatMultiplier(s) ** 2;
  for (let s = 2; s <= 60; s++) expect(power(s)).toBeGreaterThan(power(s - 1));
  for (let s = 1; s <= 60; s++) {
    const n = enemyLevelsForStage(s).length;
    expect(new Set(enemyCellsForStage(s, n)).size).toBe(n);
  }
});

test('勝利報酬は敗北報酬より常に多い', () => {
  for (let s = 1; s <= 200; s++) expect(coinReward(s, true)).toBeGreaterThan(coinReward(s, false));
});

test('砲塔は回転して敵を向いてから撃つ / 味方の弾は味方にダメージを与えない', () => {
  // player: front-centre (2) and back-centre (12) — the back gun fires through its ally.
  const b = new Battle(
    [{ id: 1, level: 2, cell: 2 }, { id: 2, level: 2, cell: 12 }],
    [{ id: 1, level: 2, cell: 2 }, { id: 2, level: 1, cell: 0 }],
    { seed: 3 },
  );
  run(b);
  const ev = b.events;
  const attacks = ev.filter((e) => e.type === 'attack');
  expect(attacks.length).toBeGreaterThan(4);
  for (const a of attacks) {
    expect(a.yawError).toBeLessThanOrEqual(AIM_TOLERANCE);
    const r = ev.find((e) => e.type === 'rotate' && e.gun === a.attacker);
    expect(r && r.t <= a.t).toBe(true);
  }
  const passes = ev.filter((e) => e.type === 'friendlyPass');
  expect(passes.length).toBeGreaterThan(0);
  for (const p of passes) { expect(p.dealt).toBe(0); expect(p.hpAfter).toBe(p.hpBefore); }
  for (const d of ev.filter((e) => e.type === 'damage')) expect(d.attacker.split('-')[0]).not.toBe(d.target.split('-')[0]);
  // direct friendly damage attempt
  const b2 = new Battle([{ id: 1, level: 5, cell: 0 }, { id: 2, level: 5, cell: 1 }], [{ id: 1, level: 1, cell: 0 }, { id: 2, level: 1, cell: 1 }]);
  const [p1, p2] = b2.guns.filter((g) => g.team === 'player');
  const [e1, e2] = b2.guns.filter((g) => g.team === 'enemy');
  expect(b2.applyHit(p1, p2, 999)).toBe(0);
  expect(b2.applyHit(e1, e2, 999)).toBe(0);
  expect(p2.hp).toBe(p2.maxHp);
  expect(e2.hp).toBe(e2.maxHp);
  expect(b2.applyHit(p1, e1, 10)).toBe(10);
  expect(e1.hp).toBe(e1.maxHp - 10);
});

test('HP0で爆発(dying)→一定時間後に消滅、片方全滅で終了', () => {
  const b = new Battle([{ id: 1, level: 50, cell: 2 }], [{ id: 1, level: 1, cell: 2 }, { id: 2, level: 1, cell: 4 }], { seed: 1 });
  const e1 = b.guns.find((g) => g.uid === 'enemy-1');
  b.applyHit(b.guns[0], e1, e1.hp);
  expect(e1.hp).toBe(0);
  expect(e1.state).toBe('dying');
  expect(b.finished).toBe(false);
  for (let t = 0; t < EXPLODE_TIME - 0.05; t += 1 / 60) b.step(1 / 60);
  expect(e1.state).toBe('dying');
  for (let i = 0; i < 10; i++) b.step(1 / 60);
  expect(e1.state).toBe('removed');
  run(b);
  expect(b.finished).toBe(true);
  expect(b.winner).toBe('player');
  expect(b.present('enemy').length).toBe(0);
  expect(b.events.at(-1).type).toBe('end');
});

test('角度ユーティリティ', () => {
  expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  expect(yawTo(0, 0, 0, -1)).toBeCloseTo(Math.PI);
  expect(yawTo(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2);
});

test('パワーアップで弾丸の形・大きさ・個数が変わる（砲身の数 = 1回の発射数）', () => {
  const reps = [1, 10, 50, 150, 350, 700, 1000];
  const designs = reps.map(gunDesign);
  // shape differs for every rank
  expect(new Set(designs.map((d) => d.bullet.shape)).size).toBe(7);
  expect(designs.map((d) => d.bullet.shape)).toEqual(BULLET_SHAPES);
  // barrel count never decreases and bullet count equals barrel count
  expect(designs.map((d) => d.barrels)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  for (const d of designs) expect(d.bullet.count).toBe(d.barrels);
  // bullet size grows with level (inside a rank and across ranks)
  let prev = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const sz = gunDesign(l).bullet.size;
    expect(sz).toBeGreaterThanOrEqual(prev);
    prev = sz;
  }
  for (let i = 1; i < designs.length; i++) expect(designs[i].bullet.size).toBeGreaterThan(designs[i - 1].bullet.size);

  // each attack fires one bullet per barrel, from each barrel, at the same time
  for (const level of reps) {
    const b = new Battle([{ id: 1, level, cell: 2 }], [{ id: 1, level: 1000, cell: 2 }], { seed: 5 });
    const g = b.guns[0];
    let guard = 0;
    while (!b.events.some((e) => e.type === 'attack' && e.attacker === g.uid) && guard++ < 2000) b.step(1 / 60);
    const atk = b.events.find((e) => e.type === 'attack' && e.attacker === g.uid);
    const n = barrelCount(level);
    expect(atk.bulletCount).toBe(n);
    expect(atk.projectiles.length).toBe(n);
    const ps = b.projectiles.filter((p) => p.owner === g.uid && p.volley === 1);
    expect(ps.length).toBe(n);
    expect(new Set(ps.map((p) => p.shape))).toEqual(new Set([gunDesign(level).bullet.shape]));
    for (const p of ps) expect(p.size).toBe(gunDesign(level).bullet.size);
    // volley damage = atk, split across bullets
    expect(ps.reduce((a, p) => a + p.dmg, 0)).toBe(g.atk);
    // bullets leave from different barrels (distinct lateral positions)
    if (n > 1) {
      const lat = ps.map((p) => p.x * Math.cos(g.yaw) - p.z * Math.sin(g.yaw)).sort((a, b) => a - b);
      for (let i = 1; i < lat.length; i++) expect(lat[i] - lat[i - 1]).toBeGreaterThan(0.1);
    }
  }
});

test('複数の弾丸がそれぞれ命中してダメージを与える', () => {
  const b = new Battle([{ id: 1, level: 400, cell: 2 }], [{ id: 1, level: 1000, cell: 2 }], { seed: 2 });
  let guard = 0;
  while (b.events.filter((e) => e.type === 'hit').length < 3 && guard++ < 3000) b.step(1 / 60);
  const hits = b.events.filter((e) => e.type === 'hit' && e.owner === 'player-1');
  const atk = b.events.find((e) => e.type === 'attack' && e.attacker === 'player-1');
  const fromFirstVolley = hits.filter((h) => atk.projectiles.includes(h.projectile));
  expect(fromFirstVolley.length).toBe(3); // 3 barrels -> 3 hits
});
