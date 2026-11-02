// Three.js renderer: board, voxel-style guns, projectiles, explosions.
import * as THREE from '../vendor/three.module.js';
import { COLS, ROWS, CELLS, CELL, cellPos, BOARD_HALF_W, BOARD_HALF_D } from './layout.js';
import { rankInfo, rankOf, gunDesign } from './gunstats.js';
import { EXPLODE_TIME, RECOIL_TIME } from './battle.js';

const TEAM_COLOR = { player: 0x3d8bff, enemy: 0xff4d4d };

function pixelTexture(url) {
  const tex = new THREE.TextureLoader().load(url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.font = 'bold 30px "DotGothic16", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = '#111';
  g.strokeText(text, 64, 26);
  g.fillStyle = color;
  g.fillText(text, 64, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1f3a);
    this.scene.fog = new THREE.Fog(0x1a1f3a, 18, 40);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.raycaster = new THREE.Raycaster();
    this.margins = { top: 0.15, bottom: 0.3 };

    this.textures = {
      explosion: pixelTexture('assets/explosion.png'),
      muzzle: pixelTexture('assets/muzzle.png'),
    };
    this.textures.explosion.repeat.set(1 / 8, 1);

    this.buildLights();
    this.buildBoard();

    this.gunMeshes = new Map(); // key -> group
    this.projMeshes = new Map();
    this.effects = [];
    this.selected = null;
    this.hoverCells = [];
    this.battle = null;
    this.clockT = 0;
    this.shake = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x30304a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -8; s.right = 8; s.top = 8; s.bottom = -8; s.near = 1; s.far = 30;
    this.scene.add(sun);
  }

  buildBoard() {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_HALF_W * 2 + 2.4, 0.4, BOARD_HALF_D * 2 + 1.6),
      new THREE.MeshLambertMaterial({ color: 0x2b3157 }),
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const mid = new THREE.Mesh(new THREE.BoxGeometry(BOARD_HALF_W * 2 + 1.6, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    mid.position.y = -0.03;
    this.scene.add(mid);

    this.tiles = { player: [], enemy: [] };
    this.pickBoxes = [];
    const tileGeo = new THREE.BoxGeometry(CELL * 0.92, 0.1, CELL * 0.92);
    const pickGeo = new THREE.BoxGeometry(CELL, 0.7, CELL);
    for (const side of ['player', 'enemy']) {
      for (let i = 0; i < CELLS; i++) {
        const p = cellPos(side, i);
        const checker = (i % COLS + Math.floor(i / COLS)) % 2 === 0;
        const base = side === 'player' ? (checker ? 0x2d5fa8 : 0x264f8c) : (checker ? 0xa83a3a : 0x8c3030);
        const mat = new THREE.MeshLambertMaterial({ color: base, emissive: 0x000000 });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(p.x, -0.05, p.z);
        tile.receiveShadow = true;
        tile.userData = { side, idx: i, base };
        this.scene.add(tile);
        this.tiles[side].push(tile);
        if (side === 'player') {
          const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial());
          pick.visible = false;
          pick.position.set(p.x, 0.35, p.z);
          pick.userData = { side, idx: i };
          this.scene.add(pick);
          this.pickBoxes.push(pick);
        }
      }
    }
  }

  setMargins(top, bottom) {
    this.margins = { top, bottom };
    this.fitCamera();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
  }

  /** Move the camera back until the whole board fits inside the area not covered by UI. */
  fitCamera() {
    const target = new THREE.Vector3(0, 0, 0.3);
    const portrait = this.camera.aspect < 0.75;
    const dir = (portrait ? new THREE.Vector3(0, 0.9, 0.42) : new THREE.Vector3(0, 0.82, 0.57)).normalize();
    const corners = [];
    for (const x of [-BOARD_HALF_W - 0.3, BOARD_HALF_W + 0.3]) for (const z of [-BOARD_HALF_D - 0.3, BOARD_HALF_D + 0.3]) for (const y of [0, 1.4]) corners.push(new THREE.Vector3(x, y, z));
    const yTop = 1 - this.margins.top * 2;
    const yBot = -1 + this.margins.bottom * 2;
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    // shift the view so that the board centre lands in the middle of the free area
    const center = (yTop + yBot) / 2;
    this.camera.setViewOffset(w, h, 0, (center * h) / 2, w, h);
    this.camera.updateProjectionMatrix();
    for (let dist = 6; dist < 60; dist += 0.2) {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      const ok = corners.every((c) => {
        const v = c.clone().project(this.camera);
        return v.x > -0.97 && v.x < 0.97 && v.y < yTop && v.y > yBot;
      });
      if (ok) break;
    }
  }

  // ---------- guns ----------
  makeGun(team, level) {
    const r = rankOf(level);
    const info = rankInfo(level);
    const group = new THREE.Group();
    const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });

    const body = new THREE.Group();
    group.add(body);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.84), lam(0x3a3f55));
    base.position.y = 0.11;
    base.castShadow = true;
    body.add(base);
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), lam(TEAM_COLOR[team], { emissive: TEAM_COLOR[team], emissiveIntensity: 0.35 }));
    ring.position.y = 0.2;
    body.add(ring);

    const turret = new THREE.Group();
    turret.position.y = 0.26;
    body.add(turret);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.56), lam(info.color));
    head.position.y = 0.18;
    head.castShadow = true;
    turret.add(head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), lam(new THREE.Color(info.color).multiplyScalar(0.7)));
    cap.position.y = 0.42;
    turret.add(cap);
    // team "eye" on the back so you can tell sides apart
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team] }));
    eye.position.set(0, 0.22, -0.29);
    turret.add(eye);

    const barrels = new THREE.Group();
    turret.add(barrels);
    const design = gunDesign(level);
    const n = design.barrels; // one bullet per barrel
    const len = design.barrelLen;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, len), lam(0x2a2a33));
      b.position.set((i - (n - 1) / 2) * design.spacing, 0.2, 0.28 + len / 2);
      b.castShadow = true;
      barrels.add(b);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.08), lam(info.color));
      tip.position.set(b.position.x, 0.2, 0.28 + len);
      barrels.add(tip);
    }
    if (r >= 7) {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), lam(0xfff1a8, { emissive: 0xffd34d, emissiveIntensity: 0.6 }));
      crown.position.y = 0.55;
      turret.add(crown);
    }

    const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.muzzle, transparent: true, depthWrite: false }));
    muzzle.position.set(0, 0.2, 0.36 + len);
    muzzle.scale.setScalar(0.45 + n * 0.12);
    muzzle.visible = false;
    turret.add(muzzle);

    const scale = design.bodyScale;
    body.scale.setScalar(scale);

    // floating UI: level label + HP bar (sprites always face the camera)
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`Lv.${level}`, info.css), transparent: true, depthTest: false }));
    label.scale.set(0.9, 0.34, 1);
    label.position.y = 1.25;
    label.renderOrder = 10;
    group.add(label);

    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, depthTest: false }));
    hpBg.scale.set(0.82, 0.1, 1);
    hpBg.position.y = 1.02;
    hpBg.renderOrder = 10;
    hpBg.visible = false;
    group.add(hpBg);
    const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: team === 'player' ? 0x4cff7a : 0xff6b6b, depthTest: false }));
    hpFg.center.set(0, 0.5);
    hpFg.scale.set(0.78, 0.07, 1);
    hpFg.position.set(-0.39, 1.02, 0);
    hpFg.renderOrder = 11;
    hpFg.visible = false;
    group.add(hpFg);

    group.userData = { team, level, design, barrelCount: n, body, turret, barrels, muzzle, label, hpBg, hpFg, baseScale: scale, materials: [] };
    group.traverse((o) => {
      if (!o.material) return;
      if (o.material.emissive) o.material.userData.baseEmissive = o.material.emissive.getHex();
      group.userData.materials.push(o.material);
    });
    return group;
  }

  disposeGroup(g) {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map && o.material.map !== this.textures.muzzle && o.material.map !== this.textures.explosion) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  clearGuns() {
    for (const g of this.gunMeshes.values()) this.disposeGroup(g);
    this.gunMeshes.clear();
    for (const m of this.projMeshes.values()) this.disposeGroup(m);
    this.projMeshes.clear();
  }

  /** Setup phase: show player placement + enemy formation. units: {id, level, cell} */
  showSetup(playerUnits, enemyUnits) {
    this.battle = null;
    const want = new Map();
    for (const u of playerUnits) want.set(`player-${u.id}`, { ...u, team: 'player' });
    for (const u of enemyUnits) want.set(`enemy-${u.id}`, { ...u, team: 'enemy' });
    for (const [key, g] of this.gunMeshes) {
      const w = want.get(key);
      if (!w || w.level !== g.userData.level || g.userData.inBattle) { this.disposeGroup(g); this.gunMeshes.delete(key); }
    }
    for (const m of this.projMeshes.values()) this.disposeGroup(m);
    this.projMeshes.clear();
    for (const [key, u] of want) {
      let g = this.gunMeshes.get(key);
      if (!g) {
        g = this.makeGun(u.team, u.level);
        this.scene.add(g);
        this.gunMeshes.set(key, g);
        g.userData.spawnT = 0.25;
      }
      const p = cellPos(u.team, u.cell);
      g.position.set(p.x, 0, p.z);
      g.userData.turret.rotation.y = u.team === 'player' ? Math.PI : 0;
      g.userData.cell = u.cell;
    }
  }

  startBattle(battle) {
    this.clearGuns();
    this.battle = battle;
    for (const gun of battle.guns) {
      const g = this.makeGun(gun.team, gun.level);
      g.position.set(gun.x, 0, gun.z);
      g.userData.inBattle = true;
      g.userData.hpBg.visible = g.userData.hpFg.visible = true;
      this.scene.add(g);
      this.gunMeshes.set(gun.uid, g);
    }
    this.setSelected(null, []);
  }

  setSelected(cellIdx, mergeTargets = []) {
    this.selected = cellIdx;
    this.hoverCells = mergeTargets;
  }

  // ---------- effects ----------
  // ---------- bullets: shape / size / colour change with rank & level ----------
  makeBullet(shape, size, color, team) {
    const g = new THREE.Group();
    const col = shape === 'pellet' ? (team === 'player' ? 0x9fd0ff : 0xffb0a0) : color;
    const core = new THREE.MeshBasicMaterial({ color: col });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const s = size;
    const add = (geo, mat, z = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; m.rotation.x = rx; g.add(m); return m; };
    switch (shape) {
      case 'pellet': // small cube
        add(new THREE.BoxGeometry(s, s, s * 1.4), core);
        break;
      case 'bullet': // long slug with a bright tip
        add(new THREE.BoxGeometry(s, s, s * 3), core);
        add(new THREE.BoxGeometry(s * 0.7, s * 0.7, s * 0.8), white, s * 1.8);
        break;
      case 'orb': // energy ball
        add(new THREE.SphereGeometry(s, 10, 8), core);
        add(new THREE.SphereGeometry(s * 0.55, 8, 6), white);
        break;
      case 'crystal': // spinning octahedron
        g.userData.spinner = add(new THREE.OctahedronGeometry(s * 1.2), core);
        g.userData.spinner.scale.z = 1.6;
        g.userData.spin = true;
        break;
      case 'missile': // cone nose + body + fins + flame
        add(new THREE.CylinderGeometry(s * 0.55, s * 0.55, s * 2.4, 8), core, 0, Math.PI / 2);
        add(new THREE.ConeGeometry(s * 0.55, s * 1.2, 8), white, s * 1.8, Math.PI / 2);
        add(new THREE.BoxGeometry(s * 1.8, s * 0.12, s * 0.6), core, -s);
        add(new THREE.BoxGeometry(s * 0.12, s * 1.8, s * 0.6), core, -s);
        add(new THREE.ConeGeometry(s * 0.45, s * 1.4, 6), new THREE.MeshBasicMaterial({ color: 0xffd34d }), -s * 2, -Math.PI / 2);
        break;
      case 'plasma': { // big glowing ball with a trail
        add(new THREE.IcosahedronGeometry(s, 1), core);
        add(new THREE.IcosahedronGeometry(s * 0.6, 0), white);
        const trail = add(new THREE.ConeGeometry(s * 0.8, s * 3, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45 }), -s * 1.8, -Math.PI / 2);
        trail.renderOrder = 2;
        break;
      }
      case 'star': { // spinning 5-pointed gold star
        const shp = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? s * 1.4 : s * 0.6;
          const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
          if (i === 0) shp.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shp.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        const geo = new THREE.ExtrudeGeometry(shp, { depth: s * 0.5, bevelEnabled: false });
        geo.center();
        g.userData.spinner = add(geo, core);
        g.userData.spin = true;
        add(new THREE.SphereGeometry(s * 0.5, 8, 6), white);
        break;
      }
      default:
        add(new THREE.BoxGeometry(s, s, s * 3), core);
    }
    if (shape === 'plasma' || shape === 'star' || shape === 'missile') {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.muzzle, color: col, transparent: true, depthWrite: false, opacity: 0.8 }));
      glow.scale.setScalar(s * 3);
      g.add(glow);
    }
    g.userData.shape = shape;
    return g;
  }

  spawnExplosion(x, z, big = true, bulletSize = 0.1) {
    const mat = new THREE.SpriteMaterial({ map: this.textures.explosion.clone(), transparent: true, depthWrite: false });
    mat.map.repeat.set(1 / 8, 1);
    mat.map.needsUpdate = true;
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, 0.6, z);
    sp.scale.setScalar(big ? 2.2 : 0.4 + bulletSize * 4);
    this.scene.add(sp);
    const light = new THREE.PointLight(0xffa040, big ? 30 : 6, 6);
    light.position.set(x, 1, z);
    this.scene.add(light);
    const parts = [];
    if (big) {
      const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: [0xffd34d, 0xff7a1a, 0x555555][i % 3] }));
        m.position.set(x, 0.5, z);
        m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5);
        this.scene.add(m);
        parts.push(m);
      }
      this.shake = Math.max(this.shake, 0.25);
    }
    this.effects.push({ kind: 'explosion', t: 0, dur: big ? EXPLODE_TIME : 0.35, sp, light, parts });
  }

  spawnMergeEffect(cell) {
    const p = cellPos('player', cell);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.15, p.z);
    this.scene.add(ring);
    this.effects.push({ kind: 'ring', t: 0, dur: 0.6, mesh: ring });
  }

  // ---------- per-frame ----------
  update(dt) {
    this.clockT += dt;
    const b = this.battle;

    // tiles highlight
    for (const tile of this.tiles.player) {
      const i = tile.userData.idx;
      let em = 0x000000;
      if (this.selected === i) em = 0x886600;
      else if (this.hoverCells.includes(i)) em = 0x335500 + Math.floor((Math.sin(this.clockT * 6) * 0.5 + 0.5) * 0x40) * 0x100;
      tile.material.emissive.setHex(em);
    }

    for (const [key, g] of this.gunMeshes) {
      const ud = g.userData;
      if (ud.spawnT > 0) {
        ud.spawnT = Math.max(0, ud.spawnT - dt);
        const k = 1 - ud.spawnT / 0.25;
        ud.body.scale.setScalar(ud.baseScale * (0.4 + 0.6 * k + Math.sin(k * Math.PI) * 0.25));
      }
      if (!b) {
        // idle bob in setup
        const sel = !ud.inBattle && ud.team === 'player' && ud.cell === this.selected;
        ud.body.position.y = sel ? 0.15 + Math.sin(this.clockT * 8) * 0.05 : 0;
        continue;
      }
      const gun = b.get(key);
      if (!gun) continue;
      ud.turret.rotation.y = gun.yaw;
      // attack motion: recoil + muzzle flash
      const rk = gun.recoilT / RECOIL_TIME;
      ud.barrels.position.z = -0.18 * rk;
      ud.turret.position.y = 0.26 + 0.04 * rk;
      ud.muzzle.visible = rk > 0.45;
      if (ud.muzzle.visible) ud.muzzle.material.rotation = Math.random() * Math.PI;
      // hit flash
      const flash = gun.hitT > 0;
      if (flash !== ud.flashing) {
        ud.flashing = flash;
        for (const m of ud.materials) if (m.emissive) m.emissive.setHex(flash ? 0x992222 : m.userData.baseEmissive);
      }
      ud.hpFg.scale.x = 0.78 * (gun.hp / gun.maxHp);
      if (gun.state === 'dying') {
        if (!ud.exploding) { ud.exploding = true; this.spawnExplosion(gun.x, gun.z, true); ud.hpBg.visible = ud.hpFg.visible = ud.label.visible = false; }
        const k = gun.dieT / EXPLODE_TIME;
        g.position.x = gun.x + (Math.random() - 0.5) * 0.12 * (1 - k);
        g.rotation.z = k * 0.6;
        ud.body.scale.setScalar(ud.baseScale * Math.max(0.01, 1 - k * k));
        ud.body.position.y = -k * 0.3;
      } else if (gun.state === 'removed') {
        this.disposeGroup(g);
        this.gunMeshes.delete(key);
      }
    }

    // projectiles
    if (b) {
      const live = new Set();
      for (const p of b.projectiles) {
        live.add(p.id);
        let m = this.projMeshes.get(p.id);
        if (!m) {
          m = this.makeBullet(p.shape, p.size, p.color, p.team);
          m.rotation.y = Math.atan2(p.vx, p.vz);
          m.userData.size = p.size;
          m.userData.owner = p.owner;
          m.userData.volley = p.volley;
          this.scene.add(m);
          this.projMeshes.set(p.id, m);
        }
        if (m.userData.spin) m.userData.spinner.rotation.z += dt * 12;
        m.position.set(p.x, 0.62, p.z);
      }
      for (const [id, m] of this.projMeshes) {
        if (!live.has(id)) { this.spawnExplosion(m.position.x, m.position.z, false, m.userData.size); this.disposeGroup(m); this.projMeshes.delete(id); }
      }
    }

    // effects
    this.effects = this.effects.filter((e) => {
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      if (e.kind === 'explosion') {
        const frame = Math.min(7, Math.floor(k * 8));
        e.sp.material.map.offset.x = frame / 8;
        e.sp.material.opacity = 1 - Math.max(0, k - 0.75) * 4;
        e.light.intensity *= 0.9;
        for (const m of e.parts) {
          m.userData.v.y -= 12 * dt;
          m.position.addScaledVector(m.userData.v, dt);
          if (m.position.y < 0.05) { m.position.y = 0.05; m.userData.v.multiplyScalar(0.5); }
        }
      } else if (e.kind === 'ring') {
        e.mesh.scale.setScalar(1 + k * 2);
        e.mesh.material.opacity = 1 - k;
      }
      if (k >= 1) {
        if (e.sp) { this.scene.remove(e.sp); e.sp.material.map.dispose(); e.sp.material.dispose(); }
        if (e.light) this.scene.remove(e.light);
        if (e.parts) e.parts.forEach((m) => { this.scene.remove(m); m.material.dispose(); });
        if (e.mesh) this.disposeGroup(e.mesh);
        return false;
      }
      return true;
    });

    // camera shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x = (Math.random() - 0.5) * this.shake * 0.4;
    } else this.camera.position.x = 0;

    this.renderer.render(this.scene, this.camera);
  }

  // ---------- picking / projection ----------
  pickCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickBoxes, false);
    return hits.length ? hits[0].object.userData.idx : null;
  }

  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  cellScreenPos(side, idx) {
    const p = cellPos(side, idx);
    return this.worldToScreen(p.x, 0.3, p.z);
  }
}

export { ROWS };
