/**
 * Task 4, option B: what random perturbations do to a cellular automaton.
 *
 * Three experiments:
 *   1. a noise sweep, measuring the steady state of a board as the per-cell
 *      flip probability is raised over five decades;
 *   2. a robustness measurement, timing how long each catalogued structure
 *      survives at each noise level;
 *   3. a damage-spreading measurement, flipping exactly one cell on a settled
 *      board and following the difference from the unperturbed board.
 *
 *   node scripts/noise-survey.mjs > docs/noise-output.md
 *
 * Figures are written to docs/images/ as a side effect.
 */
import { mkdirSync } from "node:fs";
import {
  applyNoise,
  createGrid,
  parseRule,
  randomizeGrid,
  stepInto,
} from "../src/lib/life.ts";
import { mulberry32, pointsOfArt, runSoup } from "./lib/ca.mjs";
import { writeStripPng } from "./lib/png.mjs";

const IMAGES = "docs/images";

/** Rules carried forward from Tasks 1 to 3, one per behaviour class. */
const RULES = [
  ["B3/S23", "Conway's Life"],
  ["B36/S23", "HighLife"],
  ["B358/S126", "searched in Task 3"],
  ["B5678/S02367", "frozen"],
  ["B25/S2468", "chaotic"],
  ["B2456/S156", "saturating"],
];

const NOISE_LEVELS = [0, 0.00001, 0.00003, 0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const rate = (p) => (p === 0 ? "0" : p.toExponential(1).replace(".0e", "e"));

// --------------------------------------------------------------------------
// 1. Steady state as a function of the noise rate
// --------------------------------------------------------------------------

/**
 * Runs a soup with noise and averages the density and the activity over the
 * second half of the run, after the transient.
 *
 * `activity` is the fraction of cells that change state per generation. It is
 * the order parameter here: a board frozen into still lifes has activity zero
 * however full it is, and a boiling board has activity of order 10%.
 */
function steadyState(rule, p, seed, { size = 96, burnIn = 700, measure = 700 } = {}) {
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  const rng = mulberry32(seed);
  randomizeGrid(front, 0.3, rng);
  const total = size * size;

  let densitySum = 0;
  let activitySum = 0;

  for (let generation = 1; generation <= burnIn + measure; generation++) {
    let population = stepInto(front, back, rule, true);
    let changed = 0;
    for (let i = 0; i < total; i++) if (front.cells[i] !== back.cells[i]) changed++;
    [front, back] = [back, front];

    // The flips the noise itself makes are not counted as activity: activity is
    // meant to measure what the rule is doing, not what was injected.
    if (p > 0) {
      for (const i of applyNoise(front, p, rng)) population += front.cells[i] ? 1 : -1;
    }

    if (generation > burnIn) {
      densitySum += population / total;
      activitySum += changed / total;
    }
  }
  return { density: densitySum / measure, activity: activitySum / measure, board: front };
}

function sweep(ruleText, levels = NOISE_LEVELS, seeds = 3, options = {}) {
  const rule = parseRule(ruleText);
  return levels.map((p) => {
    const runs = [];
    for (let s = 0; s < seeds; s++) runs.push(steadyState(rule, p, 9001 + s * 7717, options));
    return {
      p,
      density: mean(runs.map((r) => r.density)),
      activity: mean(runs.map((r) => r.activity)),
      board: runs[0].board,
    };
  });
}

// --------------------------------------------------------------------------
// 2. How long a structure survives
// --------------------------------------------------------------------------

/**
 * Cells within Chebyshev distance 2 of a live cell of `grid`, on a torus.
 * Built from the live cells rather than by scanning the board, so the cost
 * follows the size of the structure and not the size of the board.
 */
function neighbourhoodOf(grid) {
  const { width: w, height: h, cells } = grid;
  const region = new Set();
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        region.add((((y + dy) % h) + h) % h * w + ((((x + dx) % w) + w) % w));
      }
    }
  }
  return region;
}

/**
 * Times how long one structure survives under noise.
 *
 * A noise-free copy runs in lockstep and defines what the structure should look
 * like at every generation, which handles oscillators and spaceships without
 * special cases: the structure is intact while the noisy board agrees with the
 * reference everywhere within two cells of the reference structure. A flip that
 * the rule repairs within `grace` generations does not count as destruction, so
 * what is measured is damage that sticks.
 */
function survivalTime(rows, rule, p, seed, { size = 32, maxGenerations = 20000, grace = 4, focus = 0 } = {}) {
  const points = pointsOfArt(rows);
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  let ref = createGrid(size, size);
  let refBack = createGrid(size, size);
  const origin = (size >> 1) - 2;
  for (const [x, y] of points) {
    front.cells[(y + origin) * size + x + origin] = 1;
    ref.cells[(y + origin) * size + x + origin] = 1;
  }

  // A pattern that emits things, like a gun, would otherwise be judged on its
  // output as well as on itself. `focus` limits the comparison to a box around
  // where the pattern started, which asks only whether the pattern still works.
  let box = null;
  if (focus > 0) {
    const xs = points.map(([x]) => x + origin);
    const ys = points.map(([, y]) => y + origin);
    box = {
      x0: Math.min(...xs) - focus,
      x1: Math.max(...xs) + focus,
      y0: Math.min(...ys) - focus,
      y1: Math.max(...ys) + focus,
    };
  }
  const inFocus = (i) => {
    if (!box) return true;
    const x = i % size;
    const y = (i / size) | 0;
    return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  };

  const rng = mulberry32(seed);
  let mismatchSince = 0;

  for (let generation = 1; generation <= maxGenerations; generation++) {
    stepInto(front, back, rule, true);
    [front, back] = [back, front];
    const refPopulation = stepInto(ref, refBack, rule, true);
    [ref, refBack] = [refBack, ref];
    // The structure has to exist under this rule for the question to mean
    // anything: under a rule that kills it outright the answer is 0, not
    // "survived forever because there was nothing left to damage".
    if (refPopulation === 0) return 0;
    applyNoise(front, p, rng);

    let differs = false;
    for (const i of neighbourhoodOf(ref)) {
      if (!inFocus(i)) continue;
      if (front.cells[i] !== ref.cells[i]) {
        differs = true;
        break;
      }
    }
    if (!differs) {
      mismatchSince = 0;
      continue;
    }
    if (mismatchSince === 0) mismatchSince = generation;
    else if (generation - mismatchSince >= grace) return mismatchSince;
  }
  return maxGenerations;
}

/** Structures small enough to survive alone on a 32x32 board, as ASCII art. */
const STRUCTURES = [
  ["block", ["##", "##"]],
  ["beehive", [".##.", "#..#", ".##."]],
  ["loaf", [".##.", "#..#", ".#.#", "..#."]],
  ["boat", ["##.", "#.#", ".#."]],
  ["tub", [".#.", "#.#", ".#."]],
  ["pond", [".##.", "#..#", "#..#", ".##."]],
  ["blinker", ["###"]],
  ["toad", [".###", "###."]],
  ["beacon", ["##..", "##..", "..##", "..##"]],
  ["glider", [".#.", "..#", "###"]],
  ["lightweight spaceship", [".####", "#...#", "....#", "#..#."]],
];

// --------------------------------------------------------------------------
// 3. One flip on a settled board
// --------------------------------------------------------------------------

/**
 * Flips a single cell on a board that has already settled and follows the
 * difference from the untouched board: how many cells differ, and whether the
 * difference dies out, stays local, or spreads across the board.
 */
function damageSpread(rule, board, seed, generations = 400) {
  const size = board.width;
  const total = size * size;
  const rng = mulberry32(seed);

  let a = { ...board, cells: board.cells.slice() };
  let aBack = createGrid(size, size);
  let b = { ...board, cells: board.cells.slice() };
  let bBack = createGrid(size, size);

  const hit = Math.floor(rng() * total);
  b.cells[hit] ^= 1;

  let peak = 1;
  for (let generation = 1; generation <= generations; generation++) {
    stepInto(a, aBack, rule, true);
    [a, aBack] = [aBack, a];
    stepInto(b, bBack, rule, true);
    [b, bBack] = [bBack, b];

    let differing = 0;
    for (let i = 0; i < total; i++) if (a.cells[i] !== b.cells[i]) differing++;
    peak = Math.max(peak, differing);
    if (differing === 0) return { fate: "healed", at: generation, peak, differing: 0 };
  }

  let differing = 0;
  for (let i = 0; i < total; i++) if (a.cells[i] !== b.cells[i]) differing++;
  return { fate: differing > 0.2 * peak ? "persistent" : "shrinking", at: generations, peak, differing };
}

// --------------------------------------------------------------------------

const started = Date.now();
mkdirSync(IMAGES, { recursive: true });

console.log(`<!-- generated by scripts/noise-survey.mjs on ${new Date().toISOString().slice(0, 10)} -->`);
console.log(`\n96x96 torus from a 30% soup, 700 generations of burn-in and 700 of measurement, 3 seeds per point.\n`);

console.log("## 1. Steady state against noise rate\n");
const sweeps = new Map();
for (const [ruleText, label] of RULES) {
  const rows = sweep(ruleText);
  sweeps.set(ruleText, rows);
  console.log(`\n### \`${ruleText}\` (${label})\n`);
  console.log("| flip probability per cell per step | flips per generation | mean density | mean activity |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${rate(row.p)} | ${(row.p * 9216).toFixed(2)} | ${pct(row.density)} | ${pct(row.activity)} |`);
  }
}

// A finer sweep across the interesting decade, on two board sizes, to see
// whether the change sharpens with size the way a real phase transition would.
console.log("\n### Conway across the transition, at two board sizes\n");
const FINE = [0.0001, 0.0002, 0.0004, 0.0007, 0.001, 0.0015, 0.002, 0.003, 0.005, 0.008, 0.012, 0.02];
const fine64 = sweep("B3/S23", FINE, 6, { size: 64, burnIn: 700, measure: 700 });
const fine128 = sweep("B3/S23", FINE, 6, { size: 128, burnIn: 700, measure: 700 });
console.log("| flip probability | density 64x64 | activity 64x64 | density 128x128 | activity 128x128 |");
console.log("| --- | --- | --- | --- | --- |");
FINE.forEach((p, i) => {
  console.log(
    `| ${rate(p)} | ${pct(fine64[i].density)} | ${pct(fine64[i].activity)} | ${pct(fine128[i].density)} | ${pct(fine128[i].activity)} |`,
  );
});

// Figure: the same rule at four noise rates, after the same number of steps.
{
  const shown = [0, 0.0003, 0.003, 0.03];
  const rule = parseRule("B3/S23");
  const frames = shown.map((p) => steadyState(rule, p, 4242, { size: 96, burnIn: 1200, measure: 1 }).board);
  writeStripPng(`${IMAGES}/noise-conway-strip.png`, frames, { scale: 3 });
  console.log(`\n<!-- figure: ${IMAGES}/noise-conway-strip.png is B3/S23 at p = ${shown.join(", ")} -->`);
}

// --------------------------------------------------------------------------

console.log("\n## 2. How long each structure survives\n");
console.log("32x32 torus, one structure per board, 40 trials per cell, capped at 20000 generations.\n");

const SURVIVAL_LEVELS = [0.0003, 0.001, 0.003, 0.01];
const TRIALS = 40;
const conway = parseRule("B3/S23");

console.log("| structure | " + SURVIVAL_LEVELS.map((p) => `p = ${rate(p)}`).join(" | ") + " | vulnerable area |");
console.log("| --- |" + SURVIVAL_LEVELS.map(() => " --- |").join("") + " --- |");
const survival = [];
for (const [name, rows] of STRUCTURES) {
  const times = SURVIVAL_LEVELS.map((p) =>
    mean(Array.from({ length: TRIALS }, (_, t) => survivalTime(rows, conway, p, 1000 + t * 977))),
  );
  // If a structure dies when a flip lands in some effective area A, its lifetime
  // is about 1 / (p * A), so p * T should be the same at every noise rate.
  const areas = times.map((t, i) => 1 / (t * SURVIVAL_LEVELS[i]));
  survival.push({ name, times, area: mean(areas) });
  console.log(`| ${name} | ${times.map((t) => t.toFixed(0)).join(" | ")} | ${mean(areas).toFixed(1)} cells |`);
}

console.log(`\nRanked by lifetime at p = 1e-3:\n`);
console.log("| rank | structure | mean lifetime | lifetime relative to the block |");
console.log("| --- | --- | --- | --- |");
const blockLife = survival.find((s) => s.name === "block").times[1];
[...survival]
  .sort((a, b) => b.times[1] - a.times[1])
  .forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.name} | ${s.times[1].toFixed(0)} generations | ${(s.times[1] / blockLife).toFixed(2)}x |`);
  });

/**
 * Exhaustive single-flip census for one structure.
 *
 * Every cell within two of the structure is flipped, one at a time and with no
 * other noise, and the board is then run against a clean reference. A flip is
 * fatal if the structure has not come back by the horizon, and repaired if it
 * has. This is the deterministic version of the lifetime measurement: it says
 * exactly which perturbations the rule can undo.
 */
function fatalCells(rows, rule, { size = 32, horizon = 96 } = {}) {
  const points = pointsOfArt(rows);
  const origin = (size >> 1) - 2;
  const seedBoard = createGrid(size, size);
  for (const [x, y] of points) seedBoard.cells[(y + origin) * size + x + origin] = 1;

  const region = [...neighbourhoodOf(seedBoard)];
  let fatal = 0;

  for (const flip of region) {
    let ref = { ...seedBoard, cells: seedBoard.cells.slice() };
    let refBack = createGrid(size, size);
    let test = { ...seedBoard, cells: seedBoard.cells.slice() };
    let testBack = createGrid(size, size);
    test.cells[flip] ^= 1;

    let recovered = false;
    for (let generation = 1; generation <= horizon; generation++) {
      stepInto(ref, refBack, rule, true);
      [ref, refBack] = [refBack, ref];
      stepInto(test, testBack, rule, true);
      [test, testBack] = [testBack, test];

      // Only the neighbourhood of the reference structure is compared, so
      // debris that drifts away does not count against a structure that is
      // itself intact.
      let differs = false;
      for (const i of neighbourhoodOf(ref)) {
        if (test.cells[i] !== ref.cells[i]) {
          differs = true;
          break;
        }
      }
      if (!differs && generation > horizon - 16) {
        recovered = true;
        break;
      }
    }
    if (!recovered) fatal++;
  }
  return { region: region.length, fatal };
}

console.log(`\n### Which single flips a structure can survive\n`);
console.log(
  "Every cell within two of the structure is flipped once, on its own, and the board is run for 96 generations to see whether the structure comes back. If a structure died when a flip landed in a fraction f of that neighbourhood, and nothing else mattered, its lifetime under noise would be about 1 / (p f A).\n",
);
console.log("| structure | cells | neighbourhood | fatal flips | fatal fraction | predicted lifetime at p = 1e-3 | measured |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [name, rows] of STRUCTURES) {
  const { region, fatal } = fatalCells(rows, conway);
  const measured = survival.find((s) => s.name === name).times[1];
  console.log(
    `| ${name} | ${pointsOfArt(rows).length} | ${region} | ${fatal} | ${((fatal / region) * 100).toFixed(0)}% | ${(1 / (0.001 * fatal)).toFixed(0)} | ${measured.toFixed(0)} |`,
  );
}

// The same measurement under the rules from Task 3 that keep small structures.
console.log(`\n### The block and the blinker under other rules\n`);
console.log("| rule | block at p = 1e-3 | blinker at p = 1e-3 |");
console.log("| --- | --- | --- |");
for (const [ruleText, label] of RULES) {
  const rule = parseRule(ruleText);
  // A lifetime of 0 means the structure does not exist under that rule at all:
  // the noise-free copy dies on its own, so there is nothing for noise to damage.
  const life = (rows) => {
    const t = mean(Array.from({ length: TRIALS }, (_, i) => survivalTime(rows, rule, 0.001, 1000 + i * 977)));
    return t === 0 ? "not stable under this rule" : t.toFixed(0);
  };
  console.log(`| \`${ruleText}\` (${label}) | ${life(["##", "##"])} | ${life(["###"])} |`);
}

// Larger structures need a larger board, and two of them belong to other rules.
// These mirror entries in the site's pattern catalogue.
const LARGE = [
  ["pulsar", "B3/S23", 64, [
    "..###...###..",
    ".............",
    "#....#.#....#",
    "#....#.#....#",
    "#....#.#....#",
    "..###...###..",
    ".............",
    "..###...###..",
    "#....#.#....#",
    "#....#.#....#",
    "#....#.#....#",
    ".............",
    "..###...###..",
  ]],
  ["Gosper glider gun", "B3/S23", 96, [
    "........................#...........",
    "......................#.#...........",
    "............##......##............##",
    "...........#...#....##............##",
    "##........#.....#...##..............",
    "##........#...#.##....#.#...........",
    "..........#.....#.......#...........",
    "...........#...#....................",
    "............##......................",
  ]],
  ["HighLife replicator", "B36/S23", 96, ["..###", ".#..#", "#...#", "#..#.", "###.."]],
];

console.log(`\n### Larger structures, at p = 3e-4\n`);
console.log("| pattern | rule | board | mean lifetime |");
console.log("| --- | --- | --- | --- |");
for (const [name, ruleText, size, rows] of LARGE) {
  const rule = parseRule(ruleText);
  const life = mean(
    Array.from({ length: 10 }, (_, t) =>
      survivalTime(rows, rule, 0.0003, 3000 + t * 811, { size, maxGenerations: 4000, focus: 4 }),
    ),
  );
  console.log(`| ${name} | \`${ruleText}\` | ${size}x${size} | ${life.toFixed(0)} |`);
}

// --------------------------------------------------------------------------

console.log("\n## 3. One flip on a settled board\n");
console.log("A Conway soup is run to a cycle, one cell is flipped, and the flipped board is compared with the untouched one for 400 generations.\n");

const fates = new Map();
let peakSum = 0;
let persistentPeak = 0;
let persistentCount = 0;
const TRIALS_DAMAGE = 60;
for (let trial = 0; trial < TRIALS_DAMAGE; trial++) {
  const soup = runSoup(conway, 0.3, 60000 + trial * 6151, { size: 64, maxGenerations: 3000 });
  const result = damageSpread(conway, soup.board, 8000 + trial * 31);
  fates.set(result.fate, (fates.get(result.fate) ?? 0) + 1);
  peakSum += result.peak;
  if (result.fate !== "healed") {
    persistentPeak += result.peak;
    persistentCount++;
  }
}
console.log("| outcome after 400 generations | trials |");
console.log("| --- | --- |");
for (const [fate, count] of [...fates.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`| ${fate} | ${count} of ${TRIALS_DAMAGE} |`);
}
console.log(`\nMean largest difference: ${(peakSum / TRIALS_DAMAGE).toFixed(1)} cells over all trials, ${persistentCount ? (persistentPeak / persistentCount).toFixed(1) : "-"} cells over the trials where the damage did not heal.\n`);

// --------------------------------------------------------------------------
// 4. Damage spreading under noise: is there a threshold?
// --------------------------------------------------------------------------

/**
 * Runs two boards that differ in exactly one cell and are driven by exactly the
 * same noise, and measures how far apart they end up.
 *
 * Sharing the noise is the point. Any difference that remains is caused by the
 * one flip that separates them, not by the perturbations themselves, so the
 * final Hamming distance measures whether the noisy steady state absorbs a
 * disturbance or amplifies it.
 */
function coupledDamage(rule, p, seed, { size = 64, burnIn = 600, generations = 400 } = {}) {
  const total = size * size;
  const rng = mulberry32(seed);
  let a = createGrid(size, size);
  let aBack = createGrid(size, size);
  randomizeGrid(a, 0.3, rng);

  for (let generation = 1; generation <= burnIn; generation++) {
    stepInto(a, aBack, rule, true);
    [a, aBack] = [aBack, a];
    applyNoise(a, p, rng);
  }

  let b = { ...a, cells: a.cells.slice() };
  let bBack = createGrid(size, size);
  b.cells[Math.floor(rng() * total)] ^= 1;

  for (let generation = 1; generation <= generations; generation++) {
    stepInto(a, aBack, rule, true);
    [a, aBack] = [aBack, a];
    stepInto(b, bBack, rule, true);
    [b, bBack] = [bBack, b];
    for (const i of applyNoise(a, p, rng)) b.cells[i] ^= 1;
  }

  let differing = 0;
  for (let i = 0; i < total; i++) if (a.cells[i] !== b.cells[i]) differing++;
  return differing / total;
}

console.log("\n## 4. Damage spreading under noise\n");
console.log(
  "Two boards that differ in one cell are driven by identical noise for 400 generations after a 600-generation burn-in, on a 64x64 torus, 20 trials per point. Because the noise is shared, any difference left at the end came from the single flip.\n",
);
console.log("| flip probability | trials where the damage healed completely | mean final difference |");
console.log("| --- | --- | --- |");
const DAMAGE_LEVELS = [0, 0.00003, 0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03];
for (const p of DAMAGE_LEVELS) {
  const trials = Array.from({ length: 20 }, (_, t) => coupledDamage(conway, p, 70000 + t * 4211));
  const healed = trials.filter((d) => d === 0).length;
  console.log(`| ${rate(p)} | ${healed} of 20 | ${pct(mean(trials))} of the board |`);
}


console.error(`noise survey finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
