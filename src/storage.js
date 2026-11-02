import { CELLS } from './layout.js';

const KEY = 'gunmerge3d_save_v1';

export function defaultSave() {
  return {
    coins: 100,
    stage: 1,
    nextId: 5,
    guns: [1, 2, 3, 4].map((id) => ({ id, level: 1 })),
    layout: new Array(CELLS).fill(null),
    lang: null,
    buys: 0,
    wins: 0,
    losses: 0,
    muted: false,
    autoBattle: false,
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const s = { ...defaultSave(), ...JSON.parse(raw) };
    if (!Array.isArray(s.layout) || s.layout.length !== CELLS) s.layout = new Array(CELLS).fill(null);
    if (!Array.isArray(s.guns)) s.guns = defaultSave().guns;
    return s;
  } catch {
    return defaultSave();
  }
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
