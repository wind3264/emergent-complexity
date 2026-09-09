import { describe, expect, it } from "vitest";
import { Grid, createGrid, parseRule, populationOf, stepInto } from "./life";
import { PATTERNS, Pattern, patternSize, stampPattern } from "./patterns";

const BOARD = 200;

function boardWith(pattern: Pattern): Grid {
  const grid = createGrid(BOARD, BOARD);
  const { width, height } = patternSize(pattern);
  stampPattern(grid, pattern, Math.floor((BOARD - width) / 2), Math.floor((BOARD - height) / 2), false);
  return grid;
}

function byName(name: string): Pattern {
  const pattern = PATTERNS.find((p) => p.name === name);
  if (!pattern) throw new Error(`no pattern named ${name}`);
  return pattern;
}

/** Runs `generations` steps on a copy, leaving the caller's grid untouched. */
function run(grid: Grid, rule: string, generations: number): Grid {
  const parsed = parseRule(rule)!;
  let front = createGrid(grid.width, grid.height);
  front.cells.set(grid.cells);
  let back = createGrid(grid.width, grid.height);
  for (let i = 0; i < generations; i++) {
    stepInto(front, back, parsed, false);
    [front, back] = [back, front];
  }
  return front;
}

/** Live cells as "x,y" strings translated so the bounding box starts at the origin. */
function shape(grid: Grid): { cells: Set<string>; x: number; y: number } {
  const points: [number, number][] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y * grid.width + x]) points.push([x, y]);
    }
  }
  if (points.length === 0) return { cells: new Set(), x: 0, y: 0 };
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return {
    cells: new Set(points.map(([x, y]) => `${x - minX},${y - minY}`)),
    x: minX,
    y: minY,
  };
}

function sameShape(a: ReturnType<typeof shape>, b: ReturnType<typeof shape>): boolean {
  return a.cells.size === b.cells.size && [...a.cells].every((c) => b.cells.has(c));
}

/** True when `grid` holds exactly two disjoint translated copies of `seed`. */
function isTwoTranslatedCopies(grid: Grid, seed: Grid): boolean {
  const live = new Set<string>();
  const points: [number, number][] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y * grid.width + x]) {
        live.add(`${x},${y}`);
        points.push([x, y]);
      }
    }
  }
  const seedShape = shape(seed);
  if (points.length !== seedShape.cells.size * 2) return false;

  const offsets = [...seedShape.cells].map((c) => c.split(",").map(Number) as [number, number]);
  const order = (a: [number, number], b: [number, number]) => a[1] - b[1] || a[0] - b[0];
  const anchor = [...points].sort(order)[0];
  const seedAnchor = [...offsets].sort(order)[0];
  const dx = anchor[0] - seedAnchor[0];
  const dy = anchor[1] - seedAnchor[1];

  const first = offsets.map(([x, y]) => `${x + dx},${y + dy}`);
  if (!first.every((c) => live.has(c))) return false;

  const firstSet = new Set(first);
  const rest = points.filter(([x, y]) => !firstSet.has(`${x},${y}`));
  if (rest.length !== offsets.length) return false;

  const restMinX = Math.min(...rest.map((p) => p[0]));
  const restMinY = Math.min(...rest.map((p) => p[1]));
  const restShape = new Set(rest.map(([x, y]) => `${x - restMinX},${y - restMinY}`));
  return [...seedShape.cells].every((c) => restShape.has(c));
}

describe("catalogued patterns behave as described", () => {
  it("every pattern declares a rule that parses", () => {
    for (const pattern of PATTERNS) {
      expect(parseRule(pattern.rule), pattern.name).not.toBeNull();
      expect(pattern.rows.length).toBeGreaterThan(0);
      expect(pattern.rows.some((r) => r.includes("#")), pattern.name).toBe(true);
    }
  });

  it("glider translates one cell diagonally every 4 generations", () => {
    const start = boardWith(byName("Glider"));
    const before = shape(start);
    const after = shape(run(start, "B3/S23", 4));
    expect(sameShape(before, after)).toBe(true);
    expect([after.x - before.x, after.y - before.y]).toEqual([1, 1]);
  });

  it("lightweight spaceship translates 2 cells sideways every 4 generations", () => {
    const start = boardWith(byName("Lightweight spaceship"));
    const before = shape(start);
    const after = shape(run(start, "B3/S23", 4));
    expect(sameShape(before, after)).toBe(true);
    expect(after.y - before.y).toBe(0);
    expect(Math.abs(after.x - before.x)).toBe(2);
  });

  it("blinker has period 2", () => {
    const start = boardWith(byName("Blinker"));
    const before = shape(start);
    expect(sameShape(before, shape(run(start, "B3/S23", 1)))).toBe(false);
    expect(sameShape(before, shape(run(start, "B3/S23", 2)))).toBe(true);
  });

  it("pulsar has period 3", () => {
    const start = boardWith(byName("Pulsar"));
    const before = shape(start);
    expect(sameShape(before, shape(run(start, "B3/S23", 1)))).toBe(false);
    expect(sameShape(before, shape(run(start, "B3/S23", 3)))).toBe(true);
    expect(populationOf(run(start, "B3/S23", 3))).toBe(populationOf(start));
  });

  it("r-pentomino stays chaotic for a long time and then settles", () => {
    const start = boardWith(byName("R-pentomino"));
    const at500 = run(start, "B3/S23", 500);
    const at1103 = run(start, "B3/S23", 1103);
    const at1104 = run(start, "B3/S23", 1104);
    const at1105 = run(start, "B3/S23", 1105);
    expect(populationOf(at500)).toBeGreaterThan(100);
    // After generation 1103 only still lifes and blinkers remain, so the board
    // repeats with period 2 forever.
    expect(sameShape(shape(at1103), shape(at1105))).toBe(true);
    expect(sameShape(shape(at1103), shape(at1104))).toBe(false);
  });

  it("acorn grows far beyond its 7 starting cells", () => {
    const start = boardWith(byName("Acorn"));
    expect(populationOf(start)).toBe(7);
    expect(populationOf(run(start, "B3/S23", 500))).toBeGreaterThan(150);
  });

  it("gosper glider gun grows without bound and repeats every 30 generations", () => {
    const gun = byName("Gosper glider gun");
    const grid = createGrid(BOARD, BOARD);
    stampPattern(grid, gun, 5, 5, false);
    const pop0 = populationOf(grid);
    expect(pop0).toBe(36);
    // Each 30-generation cycle emits one 5-cell glider, so the population grows
    // by 5 per period until the first glider reaches the wall.
    expect(populationOf(run(grid, "B3/S23", 30))).toBe(pop0 + 5);
    expect(populationOf(run(grid, "B3/S23", 60))).toBe(pop0 + 10);
    expect(populationOf(run(grid, "B3/S23", 90))).toBe(pop0 + 15);
  });

  it("diehard vanishes at generation 130", () => {
    const start = boardWith(byName("Diehard"));
    expect(populationOf(start)).toBe(7);
    expect(populationOf(run(start, "B3/S23", 129))).toBeGreaterThan(0);
    expect(populationOf(run(start, "B3/S23", 130))).toBe(0);
  });

  it("highlife replicator doubles every 12 generations", () => {
    const replicator = byName("Replicator");
    expect(replicator.rule).toBe("B36/S23");
    const start = boardWith(replicator);
    const seedPop = populationOf(start);
    expect(seedPop).toBe(12);

    // At generation 12 the seed has become two copies, displaced diagonally.
    const at12 = run(start, "B36/S23", 12);
    expect(populationOf(at12)).toBe(seedPop * 2);

    // Copies interfere the way Pascal's triangle reduces mod 2: generation 24
    // holds 2 copies again (1 0 1) and generation 36 holds 4 (1 1 1 1).
    expect(populationOf(run(start, "B36/S23", 24))).toBe(seedPop * 2);
    expect(populationOf(run(start, "B36/S23", 36))).toBe(seedPop * 4);

    // The generation-12 board really is two copies of the seed, not just twice
    // as many cells.
    expect(isTwoTranslatedCopies(at12, start)).toBe(true);

    // Conway has no birth on 6, so the same seed grows into something else.
    const conwayAt12 = run(start, "B3/S23", 12);
    expect(isTwoTranslatedCopies(conwayAt12, start)).toBe(false);
    expect(sameShape(shape(conwayAt12), shape(at12))).toBe(false);
  });
});
