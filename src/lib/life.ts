/**
 * Core engine for binary outer-totalistic cellular automata on a Moore neighborhood.
 *
 * A rule is stored as two 9-bit masks. Bit `n` of `birth` is set when a dead cell
 * with exactly `n` live neighbors turns on; bit `n` of `survive` is set when a live
 * cell with exactly `n` live neighbors stays on. There are 2^18 such rules.
 */

export interface Rule {
  birth: number;
  survive: number;
}

export interface Grid {
  width: number;
  height: number;
  cells: Uint8Array;
}

/** Bitmask for a list of neighbor counts, e.g. [3] -> 0b000001000. */
export function maskOf(counts: readonly number[]): number {
  let mask = 0;
  for (const n of counts) {
    if (n >= 0 && n <= 8) mask |= 1 << n;
  }
  return mask;
}

export function hasCount(mask: number, n: number): boolean {
  return (mask & (1 << n)) !== 0;
}

export function toggleCount(mask: number, n: number): number {
  return mask ^ (1 << n);
}

/** Neighbor counts present in a mask, ascending. */
export function countsOf(mask: number): number[] {
  const out: number[] = [];
  for (let n = 0; n <= 8; n++) {
    if (hasCount(mask, n)) out.push(n);
  }
  return out;
}

export function ruleToString(rule: Rule): string {
  return `B${countsOf(rule.birth).join("")}/S${countsOf(rule.survive).join("")}`;
}

/**
 * Parses "B3/S23" and the equivalent "3/23", "S23/B3", lowercase, or spaced forms.
 * Returns null when the text is not a valid rule.
 */
export function parseRule(text: string): Rule | null {
  const compact = text.replace(/\s+/g, "").toUpperCase();
  const slash = compact.indexOf("/");
  if (slash === -1 || compact.indexOf("/", slash + 1) !== -1) return null;

  const fields = [compact.slice(0, slash), compact.slice(slash + 1)];
  // Unprefixed "3/23" means birth/survival; prefixes may appear in either order.
  let birth: string | null = null;
  let survive: string | null = null;

  fields.forEach((field, index) => {
    const letter = field[0];
    if (letter === "B") {
      if (birth === null) birth = field.slice(1);
    } else if (letter === "S") {
      if (survive === null) survive = field.slice(1);
    } else if (index === 0) {
      birth = field;
    } else {
      survive = field;
    }
  });

  if (birth === null || survive === null) return null;

  for (const digits of [birth, survive] as string[]) {
    if (!/^[0-8]*$/.test(digits)) return null;
    if (new Set(digits).size !== digits.length) return null;
  }

  return {
    birth: maskOf([...(birth as string)].map(Number)),
    survive: maskOf([...(survive as string)].map(Number)),
  };
}

export function createGrid(width: number, height: number): Grid {
  return { width, height, cells: new Uint8Array(width * height) };
}

export function clearGrid(grid: Grid): void {
  grid.cells.fill(0);
}

export function populationOf(grid: Grid): number {
  let pop = 0;
  for (let i = 0; i < grid.cells.length; i++) pop += grid.cells[i];
  return pop;
}

/** Fills the grid so each cell is live with probability `density`. */
export function randomizeGrid(grid: Grid, density: number, rng: () => number = Math.random): void {
  const { cells } = grid;
  for (let i = 0; i < cells.length; i++) {
    cells[i] = rng() < density ? 1 : 0;
  }
}

/**
 * Advances `src` one generation into `dst` and returns the new population.
 * When `wrap` is true the grid is a torus; otherwise off-grid neighbors count as dead.
 */
export function stepInto(src: Grid, dst: Grid, rule: Rule, wrap: boolean): number {
  const { width: w, height: h, cells } = src;
  const out = dst.cells;
  const { birth, survive } = rule;
  let pop = 0;

  for (let y = 0; y < h; y++) {
    const up = y === 0 ? (wrap ? h - 1 : -1) : y - 1;
    const down = y === h - 1 ? (wrap ? 0 : -1) : y + 1;
    const rowUp = up * w;
    const rowMid = y * w;
    const rowDown = down * w;

    for (let x = 0; x < w; x++) {
      const left = x === 0 ? (wrap ? w - 1 : -1) : x - 1;
      const right = x === w - 1 ? (wrap ? 0 : -1) : x + 1;

      let n = 0;
      if (up >= 0) {
        if (left >= 0) n += cells[rowUp + left];
        n += cells[rowUp + x];
        if (right >= 0) n += cells[rowUp + right];
      }
      if (left >= 0) n += cells[rowMid + left];
      if (right >= 0) n += cells[rowMid + right];
      if (down >= 0) {
        if (left >= 0) n += cells[rowDown + left];
        n += cells[rowDown + x];
        if (right >= 0) n += cells[rowDown + right];
      }

      const bit = 1 << n;
      const alive = cells[rowMid + x] !== 0;
      const next = (alive ? (survive & bit) : (birth & bit)) !== 0 ? 1 : 0;
      out[rowMid + x] = next;
      pop += next;
    }
  }

  return pop;
}

/** Convenience wrapper that allocates a fresh grid. Used by tests and one-off calls. */
export function step(src: Grid, rule: Rule, wrap: boolean): Grid {
  const dst = createGrid(src.width, src.height);
  stepInto(src, dst, rule, wrap);
  return dst;
}

/** Resizes a grid, keeping the overlapping top-left region of the old contents. */
export function resizeGrid(grid: Grid, width: number, height: number): Grid {
  const next = createGrid(width, height);
  const cols = Math.min(width, grid.width);
  const rows = Math.min(height, grid.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      next.cells[y * width + x] = grid.cells[y * grid.width + x];
    }
  }
  return next;
}

/** A 64-bit-ish string digest of the board, used to detect still lifes and cycles. */
export function hashGrid(grid: Grid): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const { cells } = grid;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) {
      h1 = (h1 ^ i) >>> 0;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (h2 + h1) >>> 0;
      h2 = Math.imul(h2, 2246822519) >>> 0;
    }
  }
  return `${h1.toString(36)}:${h2.toString(36)}`;
}
