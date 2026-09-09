import { describe, expect, it } from "vitest";
import {
  Grid,
  countsOf,
  createGrid,
  hashGrid,
  hasCount,
  maskOf,
  parseRule,
  populationOf,
  randomizeGrid,
  resizeGrid,
  ruleToString,
  step,
  toggleCount,
} from "./life";

const CONWAY = { birth: maskOf([3]), survive: maskOf([2, 3]) };

/** Builds a grid from ASCII art where "#" is live. */
function gridFrom(rows: string[]): Grid {
  const height = rows.length;
  const width = rows[0].length;
  const grid = createGrid(width, height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      grid.cells[y * width + x] = row[x] === "#" ? 1 : 0;
    }
  });
  return grid;
}

function gridTo(grid: Grid): string[] {
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let row = "";
    for (let x = 0; x < grid.width; x++) {
      row += grid.cells[y * grid.width + x] ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

describe("rule masks", () => {
  it("round-trips rule strings", () => {
    expect(ruleToString(CONWAY)).toBe("B3/S23");
    expect(ruleToString(parseRule("B36/S23")!)).toBe("B36/S23");
    expect(ruleToString(parseRule("b1357/s1357")!)).toBe("B1357/S1357");
  });

  it("accepts alternative notations", () => {
    expect(parseRule("3/23")).toEqual(CONWAY);
    expect(parseRule("S23/B3")).toEqual(CONWAY);
    expect(parseRule(" b3 / s23 ")).toEqual(CONWAY);
    expect(parseRule("23/23")).toEqual({ birth: maskOf([2, 3]), survive: maskOf([2, 3]) });
    expect(parseRule("B/S")).toEqual({ birth: 0, survive: 0 });
    expect(parseRule("B012345678/S012345678")).toEqual({ birth: 511, survive: 511 });
  });

  it("rejects malformed rules", () => {
    expect(parseRule("")).toBeNull();
    expect(parseRule("B3")).toBeNull();
    expect(parseRule("B3/S23/S4")).toBeNull();
    expect(parseRule("B9/S23")).toBeNull();
    expect(parseRule("B33/S23")).toBeNull();
    expect(parseRule("Bx/S23")).toBeNull();
  });

  it("toggles individual counts", () => {
    let mask = maskOf([3]);
    expect(hasCount(mask, 3)).toBe(true);
    expect(hasCount(mask, 6)).toBe(false);
    mask = toggleCount(mask, 6);
    expect(countsOf(mask)).toEqual([3, 6]);
    mask = toggleCount(mask, 3);
    expect(countsOf(mask)).toEqual([6]);
  });
});

describe("Conway B3/S23", () => {
  it("keeps a block still", () => {
    const block = gridFrom([
      "......",
      "..##..",
      "..##..",
      "......",
    ]);
    expect(gridTo(step(block, CONWAY, false))).toEqual(gridTo(block));
  });

  it("oscillates a blinker with period 2", () => {
    const vertical = gridFrom([
      ".....",
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ]);
    const horizontal = step(vertical, CONWAY, false);
    expect(gridTo(horizontal)).toEqual([
      ".....",
      ".....",
      ".###.",
      ".....",
      ".....",
    ]);
    expect(gridTo(step(horizontal, CONWAY, false))).toEqual(gridTo(vertical));
  });

  it("moves a glider one cell diagonally every four generations", () => {
    let grid = gridFrom([
      ".#........",
      "..#.......",
      "###.......",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ]);
    for (let i = 0; i < 4; i++) grid = step(grid, CONWAY, false);
    expect(gridTo(grid)).toEqual([
      "..........",
      "..#.......",
      "...#......",
      ".###......",
      "..........",
      "..........",
      "..........",
      "..........",
    ]);
  });

  it("kills a lone cell and a full board", () => {
    const lone = gridFrom(["...", ".#.", "..."]);
    expect(populationOf(step(lone, CONWAY, false))).toBe(0);
    const full = gridFrom(["###", "###", "###"]);
    // Corners have 3 neighbors and survive; edges have 5 and centers 8, so both die.
    expect(gridTo(step(full, CONWAY, false))).toEqual(["#.#", "...", "#.#"]);
  });
});

describe("boundaries", () => {
  it("treats off-grid neighbors as dead when wrap is off", () => {
    const corner = gridFrom(["##", "##"]);
    // Every cell of a 2x2 block on a 2x2 board has exactly 3 neighbors.
    expect(gridTo(step(corner, CONWAY, false))).toEqual(["##", "##"]);
  });

  it("wraps a glider around the torus back to its start", () => {
    const width = 8;
    const height = 8;
    const start = createGrid(width, height);
    for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) {
      start.cells[y * width + x] = 1;
    }
    let grid = start;
    // A glider crosses an 8x8 torus and returns after 4 * 8 = 32 generations.
    for (let i = 0; i < 32; i++) grid = step(grid, CONWAY, true);
    expect(gridTo(grid)).toEqual(gridTo(start));
  });

  it("counts wrapped neighbors on the seam", () => {
    // A vertical blinker split across the top and bottom rows still oscillates.
    const grid = gridFrom([
      "..#..",
      ".....",
      ".....",
      "..#..",
      "..#..",
    ]);
    // The blinker's center sits on row 4, so it flips to a horizontal bar there.
    expect(gridTo(step(grid, CONWAY, true))).toEqual([
      ".....",
      ".....",
      ".....",
      ".....",
      ".###.",
    ]);
  });
});

describe("generalized rules", () => {
  it("runs HighLife's replicator, which Conway does not sustain", () => {
    const highlife = parseRule("B36/S23")!;
    const seed = [
      "..........",
      "..........",
      "....###...",
      "...#.#....",
      "...#......",
      "..........",
      "..........",
      "..........",
    ];
    let grid = gridFrom(seed);
    for (let i = 0; i < 12; i++) grid = step(grid, highlife, false);
    // The replicator copies itself, so the population grows past the original 5.
    expect(populationOf(grid)).toBeGreaterThan(5);
  });

  it("B/S0..8 with an empty birth mask never creates cells", () => {
    const noBirth = parseRule("B/S012345678")!;
    const grid = gridFrom(["...", ".#.", "..."]);
    expect(gridTo(step(grid, noBirth, false))).toEqual(gridTo(grid));
  });

  it("B0 fills an empty board", () => {
    const seeds = parseRule("B0/S")!;
    const empty = createGrid(4, 4);
    expect(populationOf(step(empty, seeds, false))).toBe(16);
  });
});

describe("grid helpers", () => {
  it("randomizes to roughly the requested density", () => {
    const grid = createGrid(200, 200);
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    randomizeGrid(grid, 0.3, rng);
    const density = populationOf(grid) / grid.cells.length;
    expect(density).toBeGreaterThan(0.27);
    expect(density).toBeLessThan(0.33);
  });

  it("keeps the overlapping region when resizing", () => {
    const grid = gridFrom(["##.", ".#.", "..#"]);
    expect(gridTo(resizeGrid(grid, 2, 2))).toEqual(["##", ".#"]);
    expect(gridTo(resizeGrid(grid, 4, 4))).toEqual(["##..", ".#..", "..#.", "...."]);
  });

  it("hashes equal boards alike and different boards apart", () => {
    const a = gridFrom(["##.", "...", "..."]);
    const b = gridFrom(["##.", "...", "..."]);
    const c = gridFrom([".##", "...", "..."]);
    expect(hashGrid(a)).toBe(hashGrid(b));
    expect(hashGrid(a)).not.toBe(hashGrid(c));
  });
});
