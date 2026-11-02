// Pure logic tests for game rules and the battle simulation (no browser needed).
import { test, expect } from '@playwright/test';
import {
  rankOf, canMerge, mergedLevel, MAX_LEVEL, statsOf, enemyLevelsForStage, enemyStatMultiplier, coinReward, enemyCellsForStage,
  gunDesign, barrelCount, BULLET_SHAPES, spreadAngle, bulletDamage, MAX_SPREAD, dpsOf, fireInterval,
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

test('銃口の数 = レベル÷100の商+1（Lv1〜1000の全レベル）', () => {
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const d = gunDesign(l);
    expect(d.barrels).toBe(Math.floor(l / 100) + 1);
    expect(barrelCount(l)).toBe(Math.floor(l / 100) + 1);
    expect(d.barrelAngles.length).toBe(d.barrels);
    expect(d.bullet.count).toBe(d.barrels);
  }
  expect(barrelCount(1)).toBe(1);
  expect(barrelCount(99)).toBe(1);
  expect(barrelCount(100)).toBe(2);
  expect(barrelCount(550)).toBe(6);
  expect(barrelCount(1000)).toBe(11);
});

test('レベルが上がるほど放射状に広い範囲へ弾を飛ばす', () => {
  let prev = -1;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const d = gunDesign(l);
    const width = Math.max(...d.barrelAngles) - Math.min(...d.barrelAngles);
    expect(width).toBeCloseTo(spreadAngle(l), 4);
    expect(width).toBeGreaterThanOrEqual(prev); // never narrower than a lower level
    prev = width;
    // fan is symmetric around the turret's forward axis and every muzzle points in a different direction
    expect(d.barrelAngles[0]).toBeCloseTo(-d.barrelAngles.at(-1), 5);
    expect(new Set(d.barrelAngles).size).toBe(d.barrels);
  }
  expect(spreadAngle(1)).toBe(0);
  expect(spreadAngle(1000)).toBeGreaterThan(spreadAngle(500));
  expect(spreadAngle(500)).toBeGreaterThan(spreadAngle(100));
  expect(spreadAngle(1000)).toBeCloseTo(MAX_SPREAD, 4);
});

test('パワーアップで弾丸の形・大きさが変わる', () => {
  const reps = [1, 10, 50, 150, 350, 700, 1000];
  const designs = reps.map(gunDesign);
  expect(designs.map((d) => d.bullet.shape)).toEqual(BULLET_SHAPES);
  let prev = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const sz = gunDesign(l).bullet.size;
    expect(sz).toBeGreaterThanOrEqual(prev);
    prev = sz;
  }
  for (let i = 1; i < designs.length; i++) expect(designs[i].bullet.size).toBeGreaterThan(designs[i - 1].bullet.size);
});

test('攻撃1回で銃口の数だけ弾丸を同時に、各銃口の向きへ放射状に発射する', () => {
  for (const level of [1, 99, 100, 199, 250, 480, 777, 1000]) {
    const b = new Battle([{ id: 1, level, cell: 2 }], [{ id: 1, level: 1000, cell: 7 }], { seed: 5 });
    const g = b.guns[0];
    const d = gunDesign(level);
    let guard = 0;
    while (!b.events.some((e) => e.type === 'attack' && e.attacker === g.uid) && guard++ < 3000) b.step(1 / 60);
    const atk = b.events.find((e) => e.type === 'attack' && e.attacker === g.uid);
    const n = Math.floor(level / 100) + 1;
    expect(atk.bulletCount).toBe(n);
    const ps = b.projectiles.filter((p) => p.owner === g.uid && p.volley === 1);
    expect(ps.length).toBe(n); // all at the same time (same step)
    expect(new Set(ps.map((p) => p.shape))).toEqual(new Set([d.bullet.shape]));
    // each bullet flies along its muzzle's direction: turret yaw + muzzle angle
    const dirs = ps.map((p) => Math.atan2(p.vx, p.vz));
    ps.forEach((p, i) => expect(wrapAngle(dirs[i] - (atk.yaw + d.barrelAngles[p.barrel]))).toBeCloseTo(0, 6));
    // fan width of the volley == spread for that level
    const rel = dirs.map((x) => wrapAngle(x - atk.yaw));
    expect(Math.max(...rel) - Math.min(...rel)).toBeCloseTo(spreadAngle(level), 4);
    // the aiming muzzle points straight at the target
    const t = b.get(atk.target);
    const aimDir = dirs[d.aimIndex];
    expect(Math.abs(wrapAngle(aimDir - yawTo(g.x, g.z, t.x, t.z)))).toBeLessThanOrEqual(AIM_TOLERANCE + 1e-9);
    for (const p of ps) expect(p.dmg).toBe(bulletDamage(g.atk, n));
  }
});

test('放射状の弾丸が複数の敵に同時に命中する', () => {
  const enemies = [0, 1, 2, 3, 4].map((c) => ({ id: c + 1, level: 1000, cell: c })); // full enemy front row
  const b = new Battle([{ id: 1, level: 900, cell: 2 }], enemies, { seed: 2 });
  const atk = () => b.events.find((e) => e.type === 'attack' && e.attacker === 'player-1');
  let guard = 0;
  while (!atk() && guard++ < 3000) b.step(1 / 60);
  for (let i = 0; i < 90; i++) b.step(1 / 60); // let the volley land
  const vol = new Set(atk().projectiles);
  const hits = b.events.filter((e) => e.type === 'hit' && vol.has(e.projectile));
  expect(new Set(hits.map((h) => h.target)).size).toBeGreaterThanOrEqual(3);
});

test('合体: Lv.2n の銃は Lv.n の銃2台分より強い（HP・攻撃力・毎秒ダメージ）', () => {
  for (let n = 1; 2 * n <= MAX_LEVEL; n++) {
    const a = statsOf(n), b = statsOf(2 * n);
    expect(b.maxHp, `HP Lv${2 * n} vs 2×Lv${n}`).toBeGreaterThan(2 * a.maxHp);
    expect(b.atk, `ATK Lv${2 * n} vs 2×Lv${n}`).toBeGreaterThan(2 * a.atk);
    expect(dpsOf(2 * n), `DPS Lv${2 * n} vs 2×Lv${n}`).toBeGreaterThan(2 * dpsOf(n));
  }
});

test('レベルが上がるほど弾丸の発射頻度が上がる', () => {
  for (let l = 2; l <= MAX_LEVEL; l++) expect(fireInterval(l)).toBeLessThanOrEqual(fireInterval(l - 1));
  expect(fireInterval(2)).toBeLessThan(fireInterval(1)); // the very first merge already fires faster
  for (let n = 1; 2 * n <= 400; n++) expect(fireInterval(2 * n)).toBeLessThan(fireInterval(n));
  expect(1 / fireInterval(1)).toBeCloseTo(1, 5); // 1 shot/s at Lv.1
  expect(1 / fireInterval(1000)).toBeGreaterThanOrEqual(3.9); // ~4 shots/s at Lv.1000
  // real battle: a merged gun actually shoots more often
  const shotsIn = (level) => {
    const b = new Battle([{ id: 1, level, cell: 2 }], [{ id: 1, level: 1000, cell: 2 }], { seed: 9 });
    b.guns[1].hp = b.guns[1].maxHp = 1e15; // invulnerable target
    b.guns[1].atk = 0;
    for (let i = 0; i < 60 * 10; i++) b.step(1 / 60);
    return b.guns[0].shots;
  };
  expect(shotsIn(2)).toBeGreaterThan(shotsIn(1));
  expect(shotsIn(100)).toBeGreaterThan(shotsIn(10));
});

test('対戦: Lv.2n の銃1台は Lv.n の銃2台に勝つ', () => {
  for (const n of [1, 2, 3, 5, 10, 25, 50, 100, 250, 500]) {
    for (const seed of [1, 2, 3]) {
      for (const [pc, ecs] of [[2, [1, 3]], [2, [0, 4]], [7, [2, 7]]]) {
        const b = new Battle([{ id: 1, level: 2 * n, cell: pc }], ecs.map((c, i) => ({ id: i + 1, level: n, cell: c })), { seed });
        run(b, 600);
        expect(b.winner, `Lv${2 * n} vs 2×Lv${n} seed${seed} ${pc}/${ecs}`).toBe('player');
      }
    }
  }
});
