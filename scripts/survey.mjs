/**
 * Batch experiments behind docs/observations.md.
 *
 * Runs many random soups through the same engine the website uses, detects when
 * each board becomes eventually periodic, and takes a census of the structures
 * that are left over. Requires Node 22.6+ for TypeScript imports.
 *
 *   node scripts/survey.mjs > docs/survey-output.md
 */
import {
  createGrid,
  hashGrid,
  parseRule,
  populationOf,
  randomizeGrid,
  stepInto,
} from "../src/lib/life.ts";

const SIZE = 96;
const RUNS_PER_DENSITY = 12;
const MAX_GENERATIONS = 3000;
const DENSITIES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8];

/** Deterministic RNG so every number in the report can be reproduced. */
function mulberry32(seed) {
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
function runSoup(rule, density, seed, { size = SIZE, wrap = true, maxGenerations = MAX_GENERATIONS } = {}) {
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

// --------------------------------------------------------------------------
// Structure census
// --------------------------------------------------------------------------

/**
 * Groups live cells into clusters, joining any two cells within Chebyshev
 * distance 2. Structures further apart than that cannot influence each other,
 * so each cluster can be simulated on its own.
 */
function clusters(grid) {
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
function componentCount(points) {
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

function normalize(points) {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return points.map(([x, y]) => [x - minX, y - minY]);
}

/** Smallest key over the 8 rotations and reflections, so mirrored copies match. */
function canonical(points) {
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

function artOf(key) {
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
function classifyCluster(points, rule) {
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

function nameOf(key, kind) {
  const known = NAMES.get(key);
  if (known) return known;
  return `unnamed ${key.split(" ").length}-cell ${kind}`;
}

// --------------------------------------------------------------------------
// Experiments
// --------------------------------------------------------------------------

function densitySweep(ruleText) {
  const rule = parseRule(ruleText);
  const rows = [];
  for (const density of DENSITIES) {
    const settleTimes = [];
    const finalDensities = [];
    const periods = [];
    let extinct = 0;
    let unsettled = 0;

    for (let run = 0; run < RUNS_PER_DENSITY; run++) {
      const result = runSoup(rule, density, run * 7919 + Math.round(density * 1000));
      if (result.fate === "extinct") extinct++;
      else if (result.fate === "unsettled") unsettled++;
      else {
        settleTimes.push(result.enteredAt);
        periods.push(result.period);
        finalDensities.push(result.populations[result.populations.length - 1] / (SIZE * SIZE));
      }
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const median = (xs) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      return s[s.length >> 1];
    };
    rows.push({
      density,
      extinct,
      unsettled,
      settled: settleTimes.length,
      medianSettle: median(settleTimes),
      meanFinalDensity: mean(finalDensities),
      maxPeriod: periods.length ? Math.max(...periods) : 0,
    });
  }
  return rows;
}

function census(ruleText, densities, runsEach) {
  const rule = parseRule(ruleText);
  const tally = new Map();
  let boards = 0;
  let totalClusters = 0;
  let compound = 0;

  for (const density of densities) {
    for (let run = 0; run < runsEach; run++) {
      const result = runSoup(rule, density, 100000 + run * 104729 + Math.round(density * 1000));
      if (result.fate !== "periodic") continue;
      boards++;
      for (const points of clusters(result.board)) {
        if (points.length > 40) continue;
        // A cluster groups everything within 2 cells so it can be simulated in
        // isolation, but only clusters holding one touching structure are
        // counted, otherwise four nearby blinkers read as one 12-cell object.
        if (componentCount(points) !== 1) {
          compound++;
          continue;
        }
        const info = classifyCluster(points, rule);
        if (!info.key) continue;
        totalClusters++;
        const label = `${nameOf(info.key, info.kind)}|${info.kind}|${info.key}`;
        tally.set(label, (tally.get(label) ?? 0) + 1);
      }
    }
  }
  return { tally, boards, totalClusters, compound };
}

// --------------------------------------------------------------------------

const started = Date.now();
console.log(`<!-- generated by scripts/survey.mjs on ${new Date().toISOString().slice(0, 10)} -->`);
console.log(`\nBoard ${SIZE}x${SIZE} torus, ${RUNS_PER_DENSITY} soups per density, cap ${MAX_GENERATIONS} generations.\n`);

for (const ruleText of ["B3/S23", "B36/S23"]) {
  console.log(`\n## Density sweep, ${ruleText}\n`);
  console.log("| initial density | extinct | reached a cycle | never settled | median generation the cycle starts | mean final density | longest period |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of densitySweep(ruleText)) {
    console.log(
      `| ${(row.density * 100).toFixed(0)}% | ${row.extinct} | ${row.settled} | ${row.unsettled} | ${row.medianSettle} | ${(row.meanFinalDensity * 100).toFixed(2)}% | ${row.maxPeriod} |`,
    );
  }
}

for (const [ruleText, densities] of [
  ["B3/S23", [0.15, 0.3, 0.45]],
  ["B36/S23", [0.15, 0.3, 0.45]],
]) {
  console.log(`\n## Structure census, ${ruleText}\n`);
  const { tally, boards, totalClusters, compound } = census(ruleText, densities, 8);
  console.log(`${totalClusters} isolated structures on ${boards} settled boards; ${compound} touching groups were excluded.
`);
  console.log("| structure | kind | count | share | shape |");
  console.log("| --- | --- | --- | --- | --- |");
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [label, count] of sorted) {
    const [name, kind, key] = label.split("|");
    const art = artOf(key).join("<br>").replace(/\./g, "&middot;").replace(/#/g, "&#9632;");
    console.log(`| ${name} | ${kind} | ${count} | ${((count / totalClusters) * 100).toFixed(1)}% | <code>${art}</code> |`);
  }
}


// --------------------------------------------------------------------------
// Moving objects: scan mid-run boards for glider-shaped clusters directly,
// because a glider on a torus keeps the board from repeating for a long time
// and those runs often exceed the generation cap.
// --------------------------------------------------------------------------

const GLIDER_KEY = canonical([
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
]);

function gliderScan(ruleText, densities, runsEach, generations) {
  const rule = parseRule(ruleText);
  const rows = [];
  for (const density of densities) {
    let boardsWithGlider = 0;
    let gliders = 0;
    for (let run = 0; run < runsEach; run++) {
      const result = runSoup(rule, density, 555000 + run * 15485863 + Math.round(density * 1000), {
        maxGenerations: generations,
      });
      let here = 0;
      for (const points of clusters(result.board)) {
        if (points.length !== 5 || componentCount(points) !== 1) continue;
        if (canonical(normalize(points)) === GLIDER_KEY) here++;
      }
      gliders += here;
      if (here > 0) boardsWithGlider++;
    }
    rows.push({ density, boardsWithGlider, runsEach, gliders });
  }
  return rows;
}

for (const ruleText of ["B3/S23", "B36/S23"]) {
  console.log(`
## Moving objects after 1500 generations, ${ruleText}
`);
  console.log("| initial density | soups containing a glider | total gliders |");
  console.log("| --- | --- | --- |");
  for (const row of gliderScan(ruleText, [0.1, 0.2, 0.3, 0.45, 0.6], 10, 1500)) {
    console.log(`| ${(row.density * 100).toFixed(0)}% | ${row.boardsWithGlider} of ${row.runsEach} | ${row.gliders} |`);
  }
}

console.error(`survey finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
