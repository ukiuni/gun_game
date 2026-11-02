// Board geometry shared by the battle simulation and the 3D renderer.
export const COLS = 5;
export const ROWS = 3;
export const CELLS = COLS * ROWS;
export const CELL = 1.15;
export const GAP = 0.9; // half-distance between the two camps

/** World position of cell idx on a side ('player' is +z, 'enemy' is -z). Row 0 is the front row. */
export function cellPos(side, idx) {
  const c = idx % COLS;
  const r = Math.floor(idx / COLS);
  const x = (c - (COLS - 1) / 2) * CELL;
  const z = GAP + CELL / 2 + r * CELL;
  return { x: side === 'enemy' ? -x : x, z: side === 'enemy' ? -z : z };
}

export const BOARD_HALF_W = (COLS / 2) * CELL;
export const BOARD_HALF_D = GAP + ROWS * CELL;
