/**
 * Helpers shared by the batch experiment scripts.
 *
 * Everything here runs the same engine the website runs, so a number printed by
 * a script and a number read off the site come from identical code.
 */
import { createGrid, hashGrid, populationOf, randomizeGrid, stepInto } from "../../src/lib/life.ts";

/** Deterministic RNG so every number in the reports can be reproduced. */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs a soup until the exact board repeats, which means it has entered a cycle.
 * Returns the cycle, the trajectory, and the board sitting inside the cycle.
 */
export function runSoup(rule, density, seed, { size = 96, wrap = true, maxGenerations = 3000 } = {}) {
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  randomizeGrid(front, density, mulberry32(seed));

  const startPopulation = populationOf(front);
  const populations = [startPopulation];
  const seen = new Map([[hashGrid(front), 0]]);

  for (let generation = 1; generation <= maxGenerations; generation++) {
    const population = stepInto(front, back, rule, wrap);
    [front, back] = [back, front];
    populations.push(population);

    if (population === 0) {
      return { fate: "extinct", enteredAt: generation, period: 0, populations, board: front, startPopulation };
    }
    const hash = hashGrid(front);
    const earlier = seen.get(hash);
    if (earlier !== undefined) {
      return {
        fate: "periodic",
        enteredAt: earlier,
        period: generation - earlier,
        populations,
        board: front,
        startPopulation,
      };
    }
    seen.set(hash, generation);
  }
  return { fate: "unsettled", enteredAt: maxGenerations, period: 0, populations, board: front, startPopulation };
}

/**
 * Groups live cells into clusters, joining any two cells within Chebyshev
 * distance 2. Structures further apart than that cannot influence each other,
 * so each cluster can be simulated on its own.
 */
export function clusters(grid) {
  const { width: w, height: h, cells } = grid;
  const seen = new Uint8Array(w * h);
  const out = [];

  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const points = [];
    while (stack.length) {
      const index = stack.pop();
      const x = index % w;
      const y = (index / w) | 0;
      points.push([x, y]);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          // The board is a torus, so neighbors wrap.
          const nx = (((x + dx) % w) + w) % w;
          const ny = (((y + dy) % h) + h) % h;
          const n = ny * w + nx;
          if (cells[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    out.push(points);
  }
  return out;
}

/** Number of 8-connected components among a cluster's cells. */
export function componentCount(points) {
  const live = new Set(points.map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  let count = 0;
  for (const [x0, y0] of points) {
    const start = `${x0},${y0}`;
    if (seen.has(start)) continue;
    count++;
    const stack = [[x0, y0]];
    seen.add(start);
    while (stack.length) {
      const [x, y] = stack.pop();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${x + dx},${y + dy}`;
          if (live.has(key) && !seen.has(key)) {
            seen.add(key);
            stack.push([x + dx, y + dy]);
          }
        }
      }
    }
  }
  return count;
}

export function normalize(points) {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return points.map(([x, y]) => [x - minX, y - minY]);
}

/** Smallest key over the 8 rotations and reflections, so mirrored copies match. */
export function canonical(points) {
  let best = null;
  for (let variant = 0; variant < 8; variant++) {
    const mapped = points.map(([x, y]) => {
      let [a, b] = variant & 4 ? [y, x] : [x, y];
      if (variant & 1) a = -a;
      if (variant & 2) b = -b;
      return [a, b];
    });
    const key = normalize(mapped)
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join(" ");
    if (best === null || key < best) best = key;
  }
  return best;
}

export function artOf(key) {
  const points = key.split(" ").map((p) => p.split(",").map(Number));
  const w = Math.max(...points.map((p) => p[0])) + 1;
  const h = Math.max(...points.map((p) => p[1])) + 1;
  const rows = Array.from({ length: h }, () => Array(w).fill("."));
  for (const [x, y] of points) rows[y][x] = "#";
  return rows.map((r) => r.join(""));
}

/**
 * Copies a cluster onto its own small board and runs it until it repeats, which
 * gives its period and whether it moves.
 */
export function classifyCluster(points, rule) {
  const local = normalize(points);
  const w = Math.max(...local.map((p) => p[0])) + 1;
  const h = Math.max(...local.map((p) => p[1])) + 1;
  const margin = 10;
  const size = Math.max(w, h) + margin * 2;
  if (size > 60) return { kind: "large", cells: points.length, key: null, period: 0 };

  let front = createGrid(size, size);
  let back = createGrid(size, size);
  for (const [x, y] of local) front.cells[(y + margin) * size + x + margin] = 1;

  const startKey = canonical(local);
  // Translation-only key: a rotated blinker must NOT look like a moved blinker.
  const rigidKey = (pts) =>
    normalize(pts)
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join(" ");
  const startRigid = rigidKey(local);
  const seen = new Map([[hashGrid(front), 0]]);

  for (let generation = 1; generation <= 200; generation++) {
    const population = stepInto(front, back, rule, false);
    [front, back] = [back, front];
    if (population === 0) return { kind: "dies", cells: points.length, key: startKey, period: generation };

    const hash = hashGrid(front);
    if (seen.has(hash)) {
      const period = generation - seen.get(hash);
      return { kind: period === 1 ? "still life" : `oscillator p${period}`, cells: points.length, key: startKey, period };
    }
    seen.set(hash, generation);

    // The identical shape in a new place means the cluster is a spaceship. The
    // board hash would never repeat for one, so this is checked separately.
    const live = [];
    for (let i = 0; i < front.cells.length; i++) {
      if (front.cells[i]) live.push([i % size, (i / size) | 0]);
    }
    if (live.length === points.length && rigidKey(live) === startRigid) {
      return { kind: `spaceship p${generation}`, cells: points.length, key: startKey, period: generation };
    }
  }
  return { kind: "long-lived", cells: points.length, key: startKey, period: 0 };
}

/** Well-known structures, written as art so the keys are derived, not typed. */
const KNOWN = {
  block: ["##", "##"],
  tub: [".#.", "#.#", ".#."],
  boat: ["##.", "#.#", ".#."],
  ship: ["##.", "#.#", ".##"],
  "long boat": ["##..", "#.#.", ".#.#", "..#."],
  barge: [".#..", "#.#.", ".#.#", "..#."],
  beehive: [".##.", "#..#", ".##."],
  loaf: [".##.", "#..#", ".#.#", "..#."],
  pond: [".##.", "#..#", "#..#", ".##."],
  "aircraft carrier": ["##..", "#...", "...#", ".##."],
  blinker: ["###"],
  toad: [".###", "###."],
  beacon: ["##..", "##..", "..##", "..##"],
  clock: ["..#.", "#.#.", ".#.#", ".#.."],
  glider: [".#.", "..#", "###"],
  "lightweight spaceship": [".####", "#...#", "....#", "#..#."],
};

const NAMES = new Map(
  Object.entries(KNOWN).map(([name, rows]) => {
    const points = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") points.push([x, y]);
    });
    return [canonical(points), name];
  }),
);

export function nameOf(key, kind) {
  const known = NAMES.get(key);
  if (known) return known;
  return `unnamed ${key.split(" ").length}-cell ${kind}`;
}

/** Live points of an ASCII-art pattern, where "#" is a live cell. */
export function pointsOfArt(rows) {
  const points = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") points.push([x, y]);
  });
  return points;
}
