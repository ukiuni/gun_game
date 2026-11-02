// Pure game-rule helpers (no DOM / no three.js) — shared by UI, battle and tests.

export const MAX_LEVEL = 1000;

// Rank tiers. A gun's rank is derived from its level (1..1000).
// Guns of the SAME rank can be stacked on the same cell to merge: level = a + b (capped at 1000).
export const RANKS = [
  { rank: 1, min: 1, max: 9, name: 'C', color: 0x9aa3ad, css: '#9aa3ad' },
  { rank: 2, min: 10, max: 49, name: 'B', color: 0x4caf50, css: '#4caf50' },
  { rank: 3, min: 50, max: 149, name: 'A', color: 0x2f80ed, css: '#2f80ed' },
  { rank: 4, min: 150, max: 349, name: 'S', color: 0x9b51e0, css: '#9b51e0' },
  { rank: 5, min: 350, max: 699, name: 'SS', color: 0xf2994a, css: '#f2994a' },
  { rank: 6, min: 700, max: 999, name: 'SSS', color: 0xeb5757, css: '#eb5757' },
  { rank: 7, min: 1000, max: 1000, name: 'MAX', color: 0xf2c94c, css: '#f2c94c' },
];

export function clampLevel(level) {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}

export function rankOf(level) {
  const l = clampLevel(level);
  for (const r of RANKS) if (l >= r.min && l <= r.max) return r.rank;
  return 1;
}

export function rankInfo(level) {
  return RANKS[rankOf(level) - 1];
}

export function statsOf(level) {
  const l = clampLevel(level);
  const r = rankOf(l);
  return {
    level: l,
    rank: r,
    maxHp: 100 + 30 * (l - 1),
    atk: 12 + 4 * (l - 1),
    interval: +(1.1 - 0.07 * (r - 1)).toFixed(3), // seconds between shots
    turnSpeed: 2.2 + 0.25 * (r - 1), // radians / second
  };
}

/** Can gun `a` be stacked onto gun `b`? */
export function canMerge(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.level >= MAX_LEVEL || b.level >= MAX_LEVEL) return false;
  return rankOf(a.level) === rankOf(b.level);
}

export function mergedLevel(a, b) {
  return Math.min(MAX_LEVEL, a.level + b.level);
}

// Deterministic RNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Enemy army for a stage: gets bigger and stronger every stage. */
export function enemyLevelsForStage(stage) {
  const n = Math.max(1, Math.floor(stage));
  const count = Math.min(15, 2 + Math.floor((n - 1) / 2));
  const budget = Math.min(count * MAX_LEVEL, Math.max(count, Math.round(2 * Math.pow(1.38, n - 1))));
  const rng = mulberry32(n * 7919 + 13);
  const levels = new Array(count).fill(Math.floor(budget / count));
  let rest = budget - levels.reduce((s, v) => s + v, 0);
  while (rest > 0) { levels[Math.floor(rng() * count)]++; rest--; }
  return levels.map(clampLevel).sort((a, b) => b - a);
}

/** Cells the enemy occupies for a stage (0..14). */
export function enemyCellsForStage(stage, count, cells = 15) {
  const rng = mulberry32(stage * 104729 + 7);
  const all = Array.from({ length: cells }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

export function enemyStatMultiplier(stage) {
  // Small extra scaling so later stages feel tougher even at equal level.
  return 1 + Math.max(0, stage - 1) * 0.03;
}

export function shopOffer(stage, buys = 0) {
  const level = Math.max(1, Math.floor(stage / 2));
  const price = 40 * level + 5 * Math.min(buys, 20);
  return { level, price };
}

export function coinReward(stage, win) {
  return win ? 100 + 40 * stage : 10 + 5 * stage;
}

// ---- Visual / weapon design that changes with power-ups ----
// Barrel count per rank. One bullet is fired from EACH barrel per attack.
export const BARRELS_BY_RANK = [1, 1, 2, 2, 3, 3, 4];
// Bullet shape per rank (rendered by scene.js).
export const BULLET_SHAPES = ['pellet', 'bullet', 'orb', 'crystal', 'missile', 'plasma', 'star'];
const BULLET_BASE_SIZE = [0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.2];

export function barrelCount(level) {
  return BARRELS_BY_RANK[rankOf(level) - 1];
}

/** Everything that changes with level: barrels, body size, bullet shape/size/count. */
export function gunDesign(level) {
  const l = clampLevel(level);
  const info = rankInfo(l);
  const r = info.rank;
  const progress = info.max > info.min ? (l - info.min) / (info.max - info.min) : 1; // 0..1 inside the rank
  const barrels = BARRELS_BY_RANK[r - 1];
  const barrelLen = 0.55 + r * 0.04;
  const bodyScale = 0.95 + r * 0.04;
  const spacing = 0.15;
  return {
    level: l,
    rank: r,
    barrels,
    barrelLen,
    bodyScale,
    spacing,
    // lateral offsets of each barrel in turret space (already scaled to world units)
    barrelOffsets: Array.from({ length: barrels }, (_, i) => (i - (barrels - 1) / 2) * spacing * bodyScale),
    muzzleDist: (0.36 + barrelLen) * bodyScale,
    bullet: {
      shape: BULLET_SHAPES[r - 1],
      // grows with level inside the rank, approaching (but never reaching) the next rank's size
      size: +(BULLET_BASE_SIZE[r - 1] + ((BULLET_BASE_SIZE[r] ?? BULLET_BASE_SIZE[r - 1]) - BULLET_BASE_SIZE[r - 1]) * 0.85 * progress).toFixed(4),
      color: info.color,
      count: barrels,
    },
  };
}
