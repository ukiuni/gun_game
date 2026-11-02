import { GameScene } from './scene.js';
import { Battle } from './battle.js';
import { CELLS, COLS } from './layout.js';
import { t, setLang, getLang, detectLang, LANGS, applyI18n } from './i18n.js';
import { loadSave, writeSave, defaultSave, clearSave } from './storage.js';
import {
  rankOf, rankInfo, statsOf, canMerge, mergedLevel, MAX_LEVEL,
  enemyLevelsForStage, enemyCellsForStage, enemyStatMultiplier, shopOffer, coinReward,
} from './gunstats.js';
import { sfx, unlockAudio, setMuted } from './sfx.js';
import { registerServiceWorker, setupInstall, promptInstall } from './pwa.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const debugSpeed = Math.max(0.1, Number(params.get('speed')) || 1);

let save = loadSave();
setMuted(save.muted);
setLang(save.lang || detectLang());

const scene = new GameScene($('#game'));

const state = {
  screen: 'title',
  stage: save.stage,
  enemyUnits: [],
  selection: null, // {type:'tray', gunId} | {type:'cell', cell}
  battle: null,
  battleSpeed: 1,
  endTimer: 0,
  result: null,
  attempt: 0,
};

// ---------------- helpers ----------------
function persist() { writeSave(save); }
const gunById = (id) => save.guns.find((g) => g.id === id);
function rankIcon(level) { return `assets/gun_r${rankOf(level)}.png`; }

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

function gunCard(gun, { stats = false } = {}) {
  const info = rankInfo(gun.level);
  const s = statsOf(gun.level);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gun-card';
  el.dataset.gunId = gun.id;
  el.dataset.level = gun.level;
  el.style.setProperty('--rank', info.css);
  el.innerHTML = `<img class="pixel" src="${rankIcon(gun.level)}" alt=""><span class="lv">Lv.${gun.level}</span><span class="rk">${t('rank')} ${info.name}</span>` +
    (stats ? `<span class="st">${t('stats', { hp: s.maxHp, atk: s.atk })}</span>` : '');
  return el;
}

function setScreen(name) {
  state.screen = name;
  document.body.dataset.screen = name;
  updateMargins();
}

/** Keep the 3D board inside the area that is not covered by the HTML UI. */
function updateMargins() {
  const h = window.innerHeight || 1;
  let top = 0.1, bottom = 0.1;
  const scr = state.screen;
  if (scr === 'setup' || scr === 'battle') {
    const topEl = scr === 'setup' ? $('#setup .setup-top') : $('#battle .topbar');
    const botEl = scr === 'setup' ? $('#setup .setup-bottom') : null;
    top = (topEl.getBoundingClientRect().bottom + 6) / h;
    bottom = botEl ? (h - botEl.getBoundingClientRect().top + 6) / h : 0.04;
  }
  scene.setMargins(Math.min(0.3, top), Math.min(0.4, bottom));
}
window.addEventListener('resize', () => setTimeout(updateMargins, 50));

function fillLangSelects() {
  document.querySelectorAll('.lang-select').forEach((sel) => {
    sel.innerHTML = '';
    for (const [code, name] of Object.entries(LANGS)) {
      const o = document.createElement('option');
      o.value = code; o.textContent = name;
      sel.appendChild(o);
    }
    sel.value = getLang();
  });
}

function changeLang(code) {
  setLang(code);
  save.lang = getLang();
  persist();
  document.querySelectorAll('.lang-select').forEach((s) => { s.value = getLang(); });
  refreshAll();
}

function refreshAll() {
  applyI18n(document);
  if (state.screen === 'home') renderHome();
  if (state.screen === 'setup') renderSetup();
  if (state.screen === 'battle') renderHud();
  if (state.result) renderResult();
  $('#btn-sound').textContent = `${t('sound')}: ${save.muted ? t('off') : t('on')}`;
}

// ---------------- title / home ----------------
function goHome() {
  $('#result').hidden = true;
  state.result = null;
  state.battle = null;
  setScreen('home');
  showBoardPreview();
  renderHome();
}

function renderHome() {
  $('#home-coins').textContent = save.coins;
  $('#home-stage').textContent = save.stage;
  $('#home-gun-count').textContent = t('gun_count', { n: save.guns.length });
  const list = $('#home-guns');
  list.innerHTML = '';
  [...save.guns].sort((a, b) => b.level - a.level).forEach((g) => list.appendChild(gunCard(g, { stats: true })));
  const offer = shopOffer(save.stage, save.buys);
  $('#buy-label').textContent = t('buy_gun', { level: offer.level });
  $('#buy-price').textContent = `(${offer.price})`;
  $('#btn-buy').disabled = save.coins < offer.price;
  $('#btn-buy').dataset.price = offer.price;
  $('#btn-sound').textContent = `${t('sound')}: ${save.muted ? t('off') : t('on')}`;
}

function buyGun() {
  const offer = shopOffer(save.stage, save.buys);
  if (save.coins < offer.price) { sfx.error(); toast(t('not_enough')); return; }
  save.coins -= offer.price;
  save.buys++;
  save.guns.push({ id: save.nextId++, level: offer.level });
  persist();
  sfx.merge();
  toast(t('bought', { level: offer.level }));
  renderHome();
}

// ---------------- setup (placement) ----------------
function sanitizeLayout() {
  const ids = new Set(save.guns.map((g) => g.id));
  const seen = new Set();
  save.layout = save.layout.map((id) => {
    if (id == null || !ids.has(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
}

function playerUnits() {
  const out = [];
  save.layout.forEach((id, cell) => { if (id != null) { const g = gunById(id); if (g) out.push({ id, level: g.level, cell }); } });
  return out;
}
const trayGuns = () => {
  const placed = new Set(save.layout.filter((x) => x != null));
  return save.guns.filter((g) => !placed.has(g.id)).sort((a, b) => b.level - a.level || a.id - b.id);
};

function buildEnemy(stage) {
  const levels = enemyLevelsForStage(stage);
  const cells = enemyCellsForStage(stage, levels.length, CELLS);
  return levels.map((level, i) => ({ id: i + 1, level, cell: cells[i] }));
}

function showBoardPreview() {
  state.enemyUnits = buildEnemy(save.stage);
  scene.showSetup(playerUnits(), state.enemyUnits);
}

function enterSetup() {
  $('#result').hidden = true;
  state.result = null;
  state.battle = null;
  state.stage = save.stage;
  state.selection = null;
  sanitizeLayout();
  persist();
  setScreen('setup');
  showBoardPreview();
  renderSetup();
}

function selectedGun() {
  const s = state.selection;
  if (!s) return null;
  if (s.type === 'tray') return gunById(s.gunId);
  return gunById(save.layout[s.cell]);
}

function mergeTargetsFor(gun) {
  if (!gun) return [];
  const out = [];
  save.layout.forEach((id, cell) => { const o = gunById(id); if (o && canMerge(gun, o)) out.push(cell); });
  return out;
}

function renderSetup() {
  $('#setup-title').textContent = t('setup_title', { stage: save.stage });
  $('#setup-coins').textContent = save.coins;
  const maxLv = Math.max(...state.enemyUnits.map((u) => u.level));
  $('#setup-enemy').textContent = t('enemy_info', { n: state.enemyUnits.length, max: maxLv });
  const tray = $('#tray');
  tray.innerHTML = '';
  const guns = trayGuns();
  if (!guns.length) {
    const e = document.createElement('div');
    e.className = 'tray-empty';
    e.textContent = t('tray_empty');
    tray.appendChild(e);
  }
  for (const g of guns) {
    const card = gunCard(g);
    if (state.selection?.type === 'tray' && state.selection.gunId === g.id) card.classList.add('selected');
    card.addEventListener('click', () => onTrayTap(g.id));
    tray.appendChild(card);
  }
  $('#btn-start').disabled = playerUnits().length === 0;
  $('#btn-unplace').disabled = state.selection?.type !== 'cell';
  const sel = state.selection;
  scene.setSelected(sel?.type === 'cell' ? sel.cell : null, mergeTargetsFor(selectedGun()));
  scene.showSetup(playerUnits(), state.enemyUnits);
}

function onTrayTap(gunId) {
  unlockAudio();
  sfx.click();
  if (state.selection?.type === 'cell') {
    // tapping the tray while a board gun is selected -> put it back
    save.layout[state.selection.cell] = null;
    state.selection = null;
    persist();
  } else if (state.selection?.type === 'tray' && state.selection.gunId === gunId) {
    state.selection = null;
  } else {
    state.selection = { type: 'tray', gunId };
  }
  renderSetup();
}

/** Put `gun` on `to`. fromCell = null when coming from the tray. Returns 'place'|'merge'|'swap'|'max'|'none'. */
function placeGun(gun, to, fromCell) {
  if (fromCell === to) return 'none';
  const occId = save.layout[to];
  const occ = gunById(occId);
  let result;
  if (!occ) {
    save.layout[to] = gun.id;
    if (fromCell != null) save.layout[fromCell] = null;
    result = 'place';
  } else if (canMerge(gun, occ)) {
    occ.level = mergedLevel(gun, occ);
    save.guns = save.guns.filter((g) => g.id !== gun.id);
    if (fromCell != null) save.layout[fromCell] = null;
    result = 'merge';
  } else if (rankOf(gun.level) === rankOf(occ.level) && (gun.level >= MAX_LEVEL || occ.level >= MAX_LEVEL)) {
    result = 'max';
  } else {
    save.layout[to] = gun.id;
    if (fromCell != null) save.layout[fromCell] = occ.id;
    result = 'swap';
  }
  persist();
  if (result === 'merge') {
    sfx.merge();
    scene.spawnMergeEffect(to);
    toast(t('merged', { level: occ.level }));
  } else if (result === 'swap') { sfx.place(); toast(t('swapped')); }
  else if (result === 'max') { sfx.error(); toast(t('max_level')); }
  else if (result === 'place') sfx.place();
  return result;
}

function onCellTap(cell) {
  if (cell == null) return;
  unlockAudio();
  const sel = state.selection;
  if (sel?.type === 'tray') {
    const g = gunById(sel.gunId);
    state.selection = null;
    if (g) placeGun(g, cell, null);
  } else if (sel?.type === 'cell') {
    if (sel.cell === cell) state.selection = null;
    else {
      const g = gunById(save.layout[sel.cell]);
      state.selection = null;
      if (g) placeGun(g, cell, sel.cell);
    }
  } else if (save.layout[cell] != null) {
    sfx.click();
    state.selection = { type: 'cell', cell };
  }
  renderSetup();
}

function autoPlace() {
  // front row first, centre columns first
  const order = [...Array(CELLS).keys()].sort((a, b) => {
    const ra = Math.floor(a / COLS), rb = Math.floor(b / COLS);
    if (ra !== rb) return ra - rb;
    return Math.abs((a % COLS) - 2) - Math.abs((b % COLS) - 2);
  });
  for (const g of trayGuns()) {
    const cell = order.find((c) => save.layout[c] == null);
    if (cell === undefined) break;
    save.layout[cell] = g.id;
  }
  state.selection = null;
  persist();
  sfx.place();
  renderSetup();
}

// pointer input on the 3D board (tap, or drag a placed gun onto another cell)
let downCell = null, downPos = null;
const canvas = $('#game');
canvas.addEventListener('pointerdown', (e) => {
  if (state.screen !== 'setup') return;
  downCell = scene.pickCell(e.clientX, e.clientY);
  downPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (state.screen !== 'setup' || !downPos) return;
  const upCell = scene.pickCell(e.clientX, e.clientY);
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 12;
  if (moved && downCell != null && upCell != null && downCell !== upCell && save.layout[downCell] != null) {
    unlockAudio();
    state.selection = null;
    placeGun(gunById(save.layout[downCell]), upCell, downCell);
    renderSetup();
  } else if (!moved) {
    onCellTap(upCell);
  }
  downCell = null; downPos = null;
});

// ---------------- battle ----------------
function startBattle() {
  const units = playerUnits();
  if (!units.length) { sfx.error(); toast(t('need_gun')); return; }
  unlockAudio();
  state.attempt++;
  state.selection = null;
  const battle = new Battle(units, state.enemyUnits, { seed: save.stage * 1000 + state.attempt, enemyMult: enemyStatMultiplier(save.stage) });
  battle.onEvent = (ev) => {
    if (ev.type === 'attack') sfx.shot();
    else if (ev.type === 'destroyed') sfx.boom();
  };
  state.battle = battle;
  state.endTimer = 0;
  state.result = null;
  scene.startBattle(battle);
  setScreen('battle');
  renderHud();
}

function renderHud() {
  const b = state.battle;
  if (!b) return;
  $('#hud-player').textContent = b.present('player').length;
  $('#hud-enemy').textContent = b.present('enemy').length;
  $("#hud-stage").textContent = `${t("stage")} ${state.stage}`;
  $('#btn-speed').textContent = `${t('speed')} x${state.battleSpeed}`;
}

function finishBattle() {
  const b = state.battle;
  const win = b.winner === 'player';
  const stage = save.stage;
  const reward = coinReward(stage, win);
  save.coins += reward;
  if (win) { save.stage++; save.wins++; } else save.losses++;
  persist();
  state.result = { win, reward, stage };
  (win ? sfx.win : sfx.lose)();
  renderResult();
  $('#result').hidden = false;
}

function renderResult() {
  const r = state.result;
  const ov = $('#result');
  ov.classList.toggle('victory', r.win);
  ov.classList.toggle('defeat', !r.win);
  ov.dataset.result = r.win ? 'victory' : 'defeat';
  $('#result-title').textContent = r.win ? t('victory') : t('defeat');
  $('#result-coins').textContent = t('coins_earned', { n: r.reward });
}

// ---------------- main loop ----------------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let hudT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const b = state.battle;
  if (b && state.screen === 'battle') {
    if (!b.finished) {
      acc += dt * state.battleSpeed * debugSpeed;
      let n = 0;
      while (acc >= STEP && n < 2000 && !b.finished) { b.step(STEP); acc -= STEP; n++; }
    } else if (!state.result) {
      state.endTimer += dt;
      if (state.endTimer > 0.7) finishBattle();
    }
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; renderHud(); }
  }
  scene.update(dt * (b ? Math.min(debugSpeed, 4) : 1));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- wiring ----------------
fillLangSelects();
document.querySelectorAll('.lang-select').forEach((s) => s.addEventListener('change', (e) => changeLang(e.target.value)));
$('#btn-title-start').addEventListener('click', () => { unlockAudio(); sfx.click(); goHome(); });
$('#btn-play').addEventListener('click', () => { sfx.click(); enterSetup(); });
$('#btn-buy').addEventListener('click', buyGun);
$('#btn-sound').addEventListener('click', () => { save.muted = !save.muted; setMuted(save.muted); persist(); unlockAudio(); sfx.click(); refreshAll(); });
$('#btn-setup-back').addEventListener('click', () => { sfx.click(); goHome(); });
$('#btn-auto').addEventListener('click', autoPlace);
$('#btn-clear').addEventListener('click', () => { save.layout = new Array(CELLS).fill(null); state.selection = null; persist(); sfx.click(); renderSetup(); });
$('#btn-unplace').addEventListener('click', () => {
  if (state.selection?.type !== 'cell') return;
  save.layout[state.selection.cell] = null;
  state.selection = null;
  persist();
  sfx.click();
  renderSetup();
});
$('#btn-start').addEventListener('click', startBattle);
$('#btn-speed').addEventListener('click', () => { state.battleSpeed = state.battleSpeed >= 4 ? 1 : state.battleSpeed * 2; renderHud(); });
$('#btn-next').addEventListener('click', () => { sfx.click(); enterSetup(); });
$('#btn-retry').addEventListener('click', () => { sfx.click(); enterSetup(); });
$('#btn-result-home').addEventListener('click', () => { sfx.click(); goHome(); });
document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS pinch zoom
document.addEventListener('dblclick', (e) => e.preventDefault());

setScreen('title');
showBoardPreview();
refreshAll();

// ---------------- PWA ----------------
registerServiceWorker();
setupInstall((mode) => {
  $('#btn-install').hidden = mode !== 'prompt';
  $('#install-hint').hidden = mode !== 'ios';
});
$('#btn-install').addEventListener('click', async () => { sfx.click(); $('#btn-install').hidden = true; await promptInstall(); });

// ---------------- debug / test hooks ----------------
window.__game = {
  get screen() { return state.screen; },
  get save() { return save; },
  get battle() { return state.battle; },
  get selection() { return state.selection; },
  get result() { return state.result; },
  get enemyUnits() { return state.enemyUnits; },
  scene,
  cellScreenPos: (side, idx) => scene.cellScreenPos(side, idx),
  setSpeed(n) { state.battleSpeed = n; },
  setSave(obj) { save = { ...defaultSave(), ...obj }; persist(); refreshAll(); },
  resetSave() { clearSave(); save = defaultSave(); persist(); refreshAll(); },
  getLang,
};
