// Deterministic battle simulation (no rendering). The renderer reads its state every frame.
import { statsOf, mulberry32, gunDesign } from './gunstats.js';
import { cellPos } from './layout.js';

export const AIM_TOLERANCE = 0.04; // radians: turret must face the target this closely before firing
export const EXPLODE_TIME = 1.0; // seconds of explosion motion before the gun disappears
export const PROJECTILE_SPEED = 11;
export const HIT_RADIUS = 0.42;
export const RECOIL_TIME = 0.18;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** yaw such that the barrel (+z in local space) points from (x,z) to (tx,tz) */
export function yawTo(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}

export class Battle {
  /**
   * @param {{id:any, level:number, cell:number}[]} playerUnits
   * @param {{id:any, level:number, cell:number}[]} enemyUnits
   * @param {{seed?:number, enemyMult?:number}} opts
   */
  constructor(playerUnits, enemyUnits, opts = {}) {
    const rng = mulberry32(opts.seed ?? 1);
    this.time = 0;
    this.events = [];
    this.projectiles = [];
    this.finished = false;
    this.winner = null; // 'player' | 'enemy' | 'draw'
    this.nextProjectileId = 1;
    this.guns = [];
    const add = (u, team, mult) => {
      const s = statsOf(u.level);
      const p = cellPos(team, u.cell);
      const forward = team === 'player' ? Math.PI : 0; // facing the other camp
      const yaw = wrapAngle(forward + (rng() - 0.5) * 1.2); // idle scanning offset
      this.guns.push({
        uid: `${team}-${u.id}`, id: u.id, team, level: s.level, rank: s.rank, cell: u.cell,
        maxHp: Math.round(s.maxHp * mult), hp: Math.round(s.maxHp * mult), atk: Math.round(s.atk * mult),
        interval: s.interval, turnSpeed: s.turnSpeed, design: gunDesign(s.level),
        x: p.x, z: p.z, yaw, initialYaw: yaw, totalRotation: 0,
        cooldown: 0.4 + rng() * 0.6, target: null, aimed: false,
        state: 'alive', dieT: 0, recoilT: 0, hitT: 0, shots: 0,
      });
    };
    playerUnits.forEach((u) => add(u, 'player', 1));
    enemyUnits.forEach((u) => add(u, 'enemy', opts.enemyMult ?? 1));
    this.byUid = new Map(this.guns.map((g) => [g.uid, g]));
  }

  log(type, data) {
    const e = { type, t: +this.time.toFixed(3), ...data };
    this.events.push(e);
    if (this.onEvent) this.onEvent(e);
    return e;
  }

  get(uid) { return this.byUid.get(uid); }

  present(team) { return this.guns.filter((g) => g.team === team && g.state !== 'removed'); }
  alive(team) { return this.guns.filter((g) => g.team === team && g.state === 'alive'); }

  /**
   * Single place where damage is resolved. Friendly fire never deals damage.
   * @returns {number} damage dealt
   */
  applyHit(attacker, target, amount) {
    if (!attacker || !target) return 0;
    if (attacker.team === target.team) {
      this.log('noDamage', { attacker: attacker.uid, target: target.uid, reason: 'friendly' });
      return 0;
    }
    if (target.state !== 'alive') return 0;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - amount);
    target.hitT = 0.15;
    this.log('damage', { attacker: attacker.uid, target: target.uid, amount: before - target.hp, hpBefore: before, hpAfter: target.hp });
    if (target.hp <= 0) {
      target.state = 'dying';
      target.dieT = 0;
      this.log('destroyed', { target: target.uid, by: attacker.uid, team: target.team });
    }
    return before - target.hp;
  }

  pickTarget(g) {
    let best = null, bd = Infinity;
    for (const o of this.guns) {
      if (o.team === g.team || o.state !== 'alive') continue;
      const d = (o.x - g.x) ** 2 + (o.z - g.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Attack: one bullet from every barrel. Total damage of a volley = atk (split across bullets). */
  fire(g, target, yawError) {
    g.cooldown = g.interval;
    g.recoilT = RECOIL_TIME;
    g.shots++;
    const d = g.design;
    const dx = Math.sin(g.yaw), dz = Math.cos(g.yaw);
    // turret-local +x expressed in world space
    const rx = Math.cos(g.yaw), rz = -Math.sin(g.yaw);
    const n = d.barrels;
    const per = Math.floor(g.atk / n);
    const ids = [];
    for (let i = 0; i < n; i++) {
      const off = d.barrelOffsets[i];
      const dmg = per + (i < g.atk - per * n ? 1 : 0); // distribute the remainder so the sum is exactly atk
      const p = {
        id: this.nextProjectileId++, owner: g.uid, team: g.team, dmg,
        x: g.x + dx * d.muzzleDist + rx * off, z: g.z + dz * d.muzzleDist + rz * off,
        vx: dx * PROJECTILE_SPEED, vz: dz * PROJECTILE_SPEED,
        passed: new Set(), dead: false, rank: g.rank, level: g.level,
        shape: d.bullet.shape, size: d.bullet.size, color: d.bullet.color, barrel: i, volley: g.shots,
      };
      this.projectiles.push(p);
      ids.push(p.id);
    }
    this.log('attack', {
      attacker: g.uid, target: target.uid, team: g.team, yaw: g.yaw, yawError,
      projectile: ids[0], projectiles: ids, bulletCount: n, barrels: n, shape: d.bullet.shape, size: d.bullet.size,
    });
  }

  step(dt) {
    if (this.finished) return;
    this.time += dt;

    for (const g of this.guns) {
      if (g.recoilT > 0) g.recoilT = Math.max(0, g.recoilT - dt);
      if (g.hitT > 0) g.hitT = Math.max(0, g.hitT - dt);
      if (g.state === 'dying') {
        g.dieT += dt;
        if (g.dieT >= EXPLODE_TIME) {
          g.state = 'removed';
          this.log('removed', { target: g.uid, team: g.team });
        }
        continue;
      }
      if (g.state !== 'alive') continue;

      if (!g.target || g.target.state !== 'alive') {
        g.target = this.pickTarget(g);
        g.aimed = false;
      }
      g.cooldown -= dt;
      const t = g.target;
      if (!t) continue;
      const desired = yawTo(g.x, g.z, t.x, t.z);
      const diff = wrapAngle(desired - g.yaw);
      const maxTurn = g.turnSpeed * dt;
      const turn = Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
      if (turn !== 0) {
        if (g.totalRotation === 0) this.log('rotate', { gun: g.uid, target: t.uid, from: g.yaw, toward: desired });
        g.yaw = wrapAngle(g.yaw + turn);
        g.totalRotation += Math.abs(turn);
      }
      const err = Math.abs(wrapAngle(desired - g.yaw));
      if (err <= AIM_TOLERANCE) {
        if (!g.aimed) { g.aimed = true; this.log('aimed', { gun: g.uid, target: t.uid, yawError: err }); }
        if (g.cooldown <= 0) this.fire(g, t, err);
      } else {
        g.aimed = false;
      }
    }

    // projectiles: fly straight, pass through allies without damage, hit the first enemy gun
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const sub = 3;
      for (let i = 0; i < sub && !p.dead; i++) {
        p.x += (p.vx * dt) / sub;
        p.z += (p.vz * dt) / sub;
        for (const g of this.guns) {
          if (g.state !== 'alive' || g.uid === p.owner) continue;
          if ((g.x - p.x) ** 2 + (g.z - p.z) ** 2 > HIT_RADIUS * HIT_RADIUS) continue;
          if (g.team === p.team) {
            if (!p.passed.has(g.uid)) {
              p.passed.add(g.uid);
              const hpBefore = g.hp;
              const dealt = this.applyHit(this.get(p.owner), g, p.dmg); // always 0: same team
              this.log('friendlyPass', { projectile: p.id, owner: p.owner, gun: g.uid, hpBefore, hpAfter: g.hp, dealt });
            }
            continue;
          }
          this.applyHit(this.get(p.owner), g, p.dmg);
          this.log('hit', { projectile: p.id, owner: p.owner, target: g.uid });
          p.dead = true;
          break;
        }
      }
      if (Math.abs(p.x) > 4.5 || Math.abs(p.z) > 5.2) p.dead = true; // left the battlefield
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    const pLeft = this.present('player').length;
    const eLeft = this.present('enemy').length;
    if (pLeft === 0 || eLeft === 0) {
      this.finished = true;
      this.winner = pLeft > 0 ? 'player' : eLeft > 0 ? 'enemy' : 'draw';
      this.log('end', { winner: this.winner, playerLeft: pLeft, enemyLeft: eLeft });
    }
  }
}
