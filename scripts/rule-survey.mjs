/**
 * Task 3: sample the rule space and classify what the sampled rules do.
 *
 * Samples 100 outer-totalistic rules uniformly from all 2^18, runs each from
 * five random soups, and measures a few quantities that separate the broad
 * behaviours: how full the board ends up, how much of it is still changing, how
 * long the transient lasts, whether isolated moving structures appear, and
 * whether a small seed copies itself.
 *
 *   node scripts/rule-survey.mjs > docs/rule-survey-output.md
 *
 * Figures are written to docs/images/ as a side effect.
 */
import { mkdirSync } from "node:fs";
import {
  createGrid,
  hashGrid,
  parseRule,
  populationOf,
  randomizeGrid,
  ruleToString,
  stepInto,
} from "../src/lib/life.ts";
import {
  artOf,
  canonical,
  classifyCluster,
  clusters,
  componentCount,
  mulberry32,
  nameOf,
  normalize,
  pointsOfArt,
  runSoup,
} from "./lib/ca.mjs";
import { writeGridPng, writeStripPng } from "./lib/png.mjs";

const SIZE = 64;
const GENERATIONS = 800;
/** Activity and density are averaged over this many generations at the end. */
const TAIL = 50;
const DENSITIES = [0.05, 0.15, 0.3, 0.5, 0.75];
const SAMPLE = 100;
const IMAGES = "docs/images";

// --------------------------------------------------------------------------
// Measurement
// --------------------------------------------------------------------------

/**
 * Runs one soup and returns the measurements used for classification.
 *
 * `activity` is the fraction of cells that change state in a generation,
 * averaged over the last TAIL generations. It is the quantity that separates a
 * board frozen into still lifes (activity 0) from one that is still boiling.
 */
function profile(rule, density, seed, { size = SIZE, generations = GENERATIONS } = {}) {
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  randomizeGrid(front, density, mulberry32(seed));
  const total = size * size;

  const seen = new Map([[hashGrid(front), 0]]);
  let fate = "unsettled";
  let enteredAt = generations;
  let period = 0;
  let changesTail = 0;
  let densityTail = 0;
  let tailSamples = 0;
  let peak = populationOf(front) / total;
  let population = 0;

  for (let generation = 1; generation <= generations; generation++) {
    population = stepInto(front, back, rule, true);
    let changed = 0;
    for (let i = 0; i < total; i++) if (front.cells[i] !== back.cells[i]) changed++;
    [front, back] = [back, front];

    peak = Math.max(peak, population / total);
    if (generation > generations - TAIL) {
      changesTail += changed / total;
      densityTail += population / total;
      tailSamples++;
    }

    if (population === 0) {
      fate = "extinct";
      enteredAt = generation;
      break;
    }
    if (fate === "unsettled") {
      const hash = hashGrid(front);
      const earlier = seen.get(hash);
      if (earlier !== undefined) {
        fate = "periodic";
        enteredAt = earlier;
        period = generation - earlier;
      } else {
        seen.set(hash, generation);
      }
    }
  }

  return {
    fate,
    enteredAt,
    period,
    peakDensity: peak,
    finalDensity: fate === "extinct" ? 0 : population / total,
    meanDensity: tailSamples ? densityTail / tailSamples : 0,
    activity: fate === "extinct" ? 0 : tailSamples ? changesTail / tailSamples : 0,
    board: front,
  };
}

/** Isolated small structures on a board, classified by simulating each alone. */
function structures(board, rule) {
  const found = [];
  for (const points of clusters(board)) {
    if (points.length > 40 || componentCount(points) !== 1) continue;
    const info = classifyCluster(points, rule);
    if (info.key) found.push(info);
  }
  return found;
}

/**
 * Looks for self-reproduction: does the board ever become two or more disjoint
 * translated copies of the seed and nothing else?
 *
 * The copies are peeled off greedily. The topmost-then-leftmost live cell must
 * be the topmost-then-leftmost cell of some copy, so subtracting the seed placed
 * there is forced, and the test is exact rather than a heuristic.
 */
function replicationTest(rule, generations = 40, size = 128) {
  const seed = pointsOfArt([".#.", "###", "#.."]);
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  const origin = size >> 1;
  for (const [x, y] of seed) front.cells[(y + origin) * size + x + origin] = 1;

  const anchor = [...seed].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const offsets = seed.map(([x, y]) => [x - anchor[0], y - anchor[1]]);

  let best = 0;
  for (let generation = 1; generation <= generations; generation++) {
    const population = stepInto(front, back, rule, false);
    [front, back] = [back, front];
    if (population === 0 || population % seed.length !== 0 || population > 4000) continue;

    // Ascending indices are already in top-then-left order.
    const order = [];
    for (let i = 0; i < front.cells.length; i++) if (front.cells[i]) order.push(i);
    const live = new Set(order);
    let cursor = 0;
    let copies = 0;
    let ok = true;
    while (live.size) {
      while (!live.has(order[cursor])) cursor++;
      const head = order[cursor];
      const hx = head % size;
      const hy = (head / size) | 0;
      for (const [dx, dy] of offsets) {
        const x = hx + dx;
        if (x < 0 || x >= size || !live.delete((hy + dy) * size + x)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      copies++;
    }
    if (ok && copies >= 2) best = Math.max(best, copies);
  }
  return best;
}

// --------------------------------------------------------------------------
// Classification
// --------------------------------------------------------------------------

/**
 * Assigns one label per rule from the aggregate of its five runs.
 *
 * The thresholds are cuts through two measured quantities, final density and
 * activity, and are stated in the report so the boundaries are visible rather
 * than implied.
 */
function classify(runs, replicates) {
  const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  const density = mean((r) => r.meanDensity);
  const activity = mean((r) => r.activity);
  const extinct = runs.filter((r) => r.fate === "extinct").length;

  if (replicates >= 2) return "self-replicating";
  if (extinct === runs.length || density < 0.002) return "extinction";
  if (density > 0.5) return "saturating";
  if (activity < 0.002) return "frozen";
  if (activity < 0.02) return "locally oscillating";
  if (activity > 0.12) return "chaotic";
  return "complex";
}

// --------------------------------------------------------------------------
// The sample
// --------------------------------------------------------------------------

/** `allowB0` false rejects rules where a dead cell with no live neighbours is born. */
function sampleRules(count, seed, allowB0) {
  const rng = mulberry32(seed);
  const rules = [];
  const seenRules = new Set();
  while (rules.length < count) {
    const rule = {
      birth: Math.floor(rng() * 512),
      survive: Math.floor(rng() * 512),
    };
    if (!allowB0 && rule.birth & 1) continue;
    const text = ruleToString(rule);
    if (seenRules.has(text)) continue;
    seenRules.add(text);
    rules.push(rule);
  }
  return rules;
}

function survey(rules) {
  return rules.map((rule) => {
    const runs = DENSITIES.map((density, i) => {
      const result = profile(rule, density, 20000 + i * 7717 + rule.birth * 31 + rule.survive);
      const found = result.fate === "extinct" ? [] : structures(result.board, rule);
      return {
        ...result,
        density,
        spaceships: found.filter((s) => s.kind.startsWith("spaceship")).length,
        found,
      };
    });
    const replicates = replicationTest(rule);
    return { rule, text: ruleToString(rule), runs, replicates, klass: classify(runs, replicates) };
  });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

function summarize(entry) {
  return {
    density: mean(entry.runs.map((r) => r.meanDensity)),
    activity: mean(entry.runs.map((r) => r.activity)),
    settled: entry.runs.filter((r) => r.fate === "periodic").length,
    extinct: entry.runs.filter((r) => r.fate === "extinct").length,
    transient: mean(entry.runs.filter((r) => r.fate === "periodic").map((r) => r.enteredAt)),
    spaceships: entry.runs.reduce((a, r) => a + r.spaceships, 0),
  };
}

function classTable(results) {
  const byClass = new Map();
  for (const entry of results) {
    if (!byClass.has(entry.klass)) byClass.set(entry.klass, []);
    byClass.get(entry.klass).push(entry);
  }
  const order = [
    "extinction",
    "frozen",
    "locally oscillating",
    "complex",
    "chaotic",
    "saturating",
    "self-replicating",
  ];
  console.log("| class | rules | mean final density | mean activity | example rules |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const klass of order) {
    const entries = byClass.get(klass);
    if (!entries) continue;
    const s = entries.map(summarize);
    const examples = entries.slice(0, 3).map((e) => `\`${e.text}\``).join(", ");
    console.log(
      `| ${klass} | ${entries.length} | ${pct(mean(s.map((x) => x.density)))} | ${pct(mean(s.map((x) => x.activity)))} | ${examples} |`,
    );
  }
  return byClass;
}

function detailTable(results) {
  console.log("| rule | class | final density | activity | soups that settled | mean transient | spaceships seen |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of [...results].sort((a, b) => a.klass.localeCompare(b.klass) || a.text.localeCompare(b.text))) {
    const s = summarize(entry);
    console.log(
      `| \`${entry.text}\` | ${entry.klass} | ${pct(s.density)} | ${pct(s.activity)} | ${s.settled}/${DENSITIES.length} | ${s.transient ? s.transient.toFixed(0) : "-"} | ${s.spaceships} |`,
    );
  }
}

/** How often a rule's five soups disagree about what the rule does. */
function agreementTable(results) {
  const runClass = (r) => {
    if (r.fate === "extinct" || r.meanDensity < 0.002) return "extinction";
    if (r.meanDensity > 0.5) return "saturating";
    if (r.activity < 0.002) return "frozen";
    if (r.activity < 0.02) return "locally oscillating";
    if (r.activity > 0.12) return "chaotic";
    return "complex";
  };
  let disagree = 0;
  const flips = new Map();
  for (const entry of results) {
    const labels = new Set(entry.runs.map(runClass));
    if (labels.size > 1) {
      disagree++;
      const key = [...labels].sort().join(" / ");
      flips.set(key, (flips.get(key) ?? 0) + 1);
    }
  }
  console.log(`${disagree} of ${results.length} rules did not give the same behaviour from all ${DENSITIES.length} soups.\n`);
  console.log("| behaviours seen from one rule | rules |");
  console.log("| --- | --- |");
  for (const [key, count] of [...flips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`| ${key} | ${count} |`);
  }
}

// --------------------------------------------------------------------------

const started = Date.now();
mkdirSync(IMAGES, { recursive: true });

console.log(`<!-- generated by scripts/rule-survey.mjs on ${new Date().toISOString().slice(0, 10)} -->`);
console.log(
  `\n${SIZE}x${SIZE} torus, ${DENSITIES.length} soups per rule at densities ${DENSITIES.map((d) => `${d * 100}%`).join(", ")}, ${GENERATIONS} generations each.\n`,
);

console.log("\n## Sample A: 100 rules drawn uniformly from all 2^18\n");
const uniform = survey(sampleRules(SAMPLE, 424242, true));
const uniformB0 = uniform.filter((e) => e.rule.birth & 1);
console.log(`${uniformB0.length} of the ${SAMPLE} sampled rules contain B0.\n`);
classTable(uniform);

console.log("\n### The same sample split on whether the rule contains B0\n");
console.log("| subset | rules | mean final density | mean activity |");
console.log("| --- | --- | --- | --- |");
for (const [label, subset] of [
  ["contains B0", uniformB0],
  ["no B0", uniform.filter((e) => !(e.rule.birth & 1))],
]) {
  const s = subset.map(summarize);
  console.log(`| ${label} | ${subset.length} | ${pct(mean(s.map((x) => x.density)))} | ${pct(mean(s.map((x) => x.activity)))} |`);
}

console.log("\n## Sample B: 100 rules drawn uniformly from the 2^17 rules without B0\n");
const sample = survey(sampleRules(SAMPLE, 987654, false));
const byClass = classTable(sample);

console.log("\n### Initial conditions disagree\n");
agreementTable(sample);

console.log("\n### Every rule in sample B\n");
detailTable(sample);

// Figures: one board per class, taken from the 30% soup at generation 800.
for (const [klass, entries] of byClass) {
  const entry = entries[0];
  const run = entry.runs[2];
  const slug = klass.replace(/[^a-z]+/g, "-");
  writeGridPng(`${IMAGES}/class-${slug}.png`, run.board, { scale: 4 });
  console.log(`\n<!-- figure: ${IMAGES}/class-${slug}.png is ${entry.text} at generation ${GENERATIONS} -->`);
}

// --------------------------------------------------------------------------
// Designing rules: a two-stage search for something Life-like
// --------------------------------------------------------------------------

/**
 * Ranks rules by the two properties Conway's rule turned out to have in Task 1.
 *
 * First, every initial density has to land in the same sparse band, which is the
 * attractor seen in Task 1 where soups from 10% to 70% all settled near 3% full.
 * Second, the board has to still be doing something. Among the rules that pass
 * both, the score is how long the transient lasts, because a rule whose soups
 * take a thousand generations to resolve is doing more work on the way than one
 * that freezes in ten.
 */
function transientOf(run) {
  return run.fate === "unsettled" ? GENERATIONS : run.enteredAt;
}

function lifeLikeScore(entry) {
  const densities = entry.runs.map((r) => r.meanDensity);
  const activity = mean(entry.runs.map((r) => r.activity));
  // The band is calibrated on Conway, the one rule known in advance to be worth
  // finding: its 5% soup collapses to 0.44% full, so a floor of 0.5% would
  // reject the very rule the search is looking for more of.
  if (!densities.every((d) => d >= 0.002 && d <= 0.12)) return -1;
  if (activity < 0.001 || activity > 0.05) return -1;
  return mean(entry.runs.map(transientOf));
}

/**
 * Every pattern that fits in a 4x4 box, one per shape.
 *
 * Rotations and reflections of a pattern behave the same way under an
 * outer-totalistic rule, so only one member of each symmetry class is kept. That
 * cuts the 65535 bit patterns to a few thousand and makes it affordable to run
 * the search for every candidate rule rather than for a hand-picked few.
 */
const SHIP_SEEDS = (() => {
  const box = 4;
  const seen = new Set();
  const out = [];
  for (let bits = 1; bits < 1 << (box * box); bits++) {
    const points = [];
    for (let k = 0; k < box * box; k++) {
      if (bits & (1 << k)) points.push([k % box, (k / box) | 0]);
    }
    if (points.length < 2) continue;
    const key = canonical(points);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalize(points));
  }
  return out;
})();

/**
 * Searches for a spaceship: each seed is run alone until it dies, repeats where
 * it stands, or reappears in the same shape somewhere else, which is what a
 * spaceship does.
 */
function smallestSpaceship(rule, { size = 20, generations = 12 } = {}) {
  const a = createGrid(size, size);
  const b = createGrid(size, size);
  const origin = (size >> 1) - 2;
  const found = new Set();
  let best = null;

  for (const points of SHIP_SEEDS) {
    a.cells.fill(0);
    b.cells.fill(0);
    for (const [x, y] of points) a.cells[(y + origin) * size + x + origin] = 1;
    const startKey = points.map(([x, y]) => `${x},${y}`).sort().join(" ");

    let current = a;
    let scratch = b;
    for (let generation = 1; generation <= generations; generation++) {
      const population = stepInto(current, scratch, rule, false);
      [current, scratch] = [scratch, current];
      if (population === 0) break;
      if (population !== points.length) continue;

      const live = [];
      for (let i = 0; i < current.cells.length; i++) if (current.cells[i]) live.push([i % size, (i / size) | 0]);
      const key = normalize(live)
        .map(([x, y]) => `${x},${y}`)
        .sort()
        .join(" ");
      if (key !== startKey) continue;
      // Same shape in the same orientation: a spaceship if it also moved.
      const moved = live.some(([x, y], i) => x !== points[i][0] + origin || y !== points[i][1] + origin);
      if (!moved) break;
      found.add(canonical(points));
      if (!best || points.length < best.cells) best = { cells: points.length, period: generation, key: startKey };
      break;
    }
  }
  return { count: found.size, best };
}

/**
 * Cheap screen for the two properties Conway's rule has and almost nothing else
 * does: the board ends up sparse but not empty, and it is still changing.
 *
 * A rule is abandoned as soon as it is clearly saturating, which is what makes
 * screening thousands of rules affordable, because most of the rule space fills
 * the board within a few dozen generations and can be rejected there.
 */
function screen(rule, { size = 48, generations = 250, seed = 5150 } = {}) {
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  randomizeGrid(front, 0.3, mulberry32(seed));
  const total = size * size;
  let changed = 0;
  let population = 0;

  for (let generation = 1; generation <= generations; generation++) {
    population = stepInto(front, back, rule, true);
    if (generation > generations - 20) {
      for (let i = 0; i < total; i++) if (front.cells[i] !== back.cells[i]) changed++;
    }
    [front, back] = [back, front];
    if (population === 0) return null;
    if (generation === 60 && population / total > 0.35) return null; // saturating
  }
  const density = population / total;
  const activity = changed / (20 * total);
  if (density < 0.005 || density > 0.15) return null;
  if (activity < 0.002) return null; // frozen dust
  return { density, activity };
}

const SCREEN_COUNT = 3000;

console.log(`\n## Designing rules: searching for Life-like behaviour\n`);
console.log(
  `The random samples above contain nothing that behaves like Conway's rule, so the space was searched rather than sampled. Stage one screens ${SCREEN_COUNT} rules without B0 on a single 48x48 soup at 30% density, keeping only those whose board is between 0.5% and 15% full after 250 generations and is still changing at least 0.2% of its cells per generation. Stage two runs the survivors through the same five-soup measurement used above.\n`,
);

const candidates = [];
const screened = sampleRules(SCREEN_COUNT, 20260909, false);
for (const rule of screened) {
  if (screen(rule)) candidates.push(rule);
}
console.log(
  `${candidates.length} of ${screened.length} rules passed the screen, ${((candidates.length / screened.length) * 100).toFixed(1)}%.\n`,
);

const searched = survey(candidates).sort((a, b) => lifeLikeScore(b) - lifeLikeScore(a));
const passing = searched.filter((e) => lifeLikeScore(e) >= 0);
console.log(
  `${passing.length} of those ${candidates.length} then satisfied the two Task 1 properties in stage two: every one of the five soups settles between 0.2% and 12% full, and the board is still changing between 0.1% and 5% of its cells per generation. They are ranked by mean transient length.\n`,
);

const reference = new Map(["B3/S23", "B36/S23"].map((text) => [text, survey([parseRule(text)])[0]]));

function scoreRow(entry, label = "") {
  const s = summarize(entry);
  const score = lifeLikeScore(entry);
  return `| \`${entry.text}\`${label} | ${entry.klass} | ${pct(s.density)} | ${pct(s.activity)} | ${s.settled}/${DENSITIES.length} | ${entry.ships.count} | ${score < 0 ? "rejected" : score.toFixed(0)} |`;
}

// Mobility, tested directly rather than inferred: every pattern that fits in a
// 4x4 box is run alone to see whether the rule moves any of them.
for (const entry of [...passing, ...reference.values()]) entry.ships = smallestSpaceship(entry.rule);
const mobile = passing.filter((e) => e.ships.count > 0);
console.log(
  `Every pattern that fits in a 4x4 box, one per shape up to rotation and reflection, was then run alone under each of the ${passing.length} surviving rules to see whether the rule moves any of them. ${mobile.length} of the ${passing.length} have at least one spaceship.\n`,
);

console.log(
  "| rule | class | final density | activity | soups that settled | spaceship shapes in a 4x4 box | score: mean transient |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const entry of passing.slice(0, 12)) console.log(scoreRow(entry));
for (const [text, entry] of reference) console.log(scoreRow(entry, text === "B3/S23" ? " (Conway)" : " (HighLife)"));

console.log(`\nThe rules that pass the filter and also have a spaceship:\n`);
console.log("| rule | smallest spaceship | period | distinct shapes | score: mean transient |");
console.log("| --- | --- | --- | --- | --- |");
for (const entry of mobile) {
  console.log(
    `| \`${entry.text}\` | ${entry.ships.best.cells} cells | ${entry.ships.best.period} | ${entry.ships.count} | ${lifeLikeScore(entry).toFixed(0)} |`,
  );
}
for (const [text, entry] of reference) {
  console.log(
    `| \`${text}\` (${text === "B3/S23" ? "Conway" : "HighLife"}) | ${entry.ships.best.cells} cells | ${entry.ships.best.period} | ${entry.ships.count} | ${lifeLikeScore(entry).toFixed(0)} |`,
  );
}

// --------------------------------------------------------------------------
// Closer look at the most Life-like rule found
// --------------------------------------------------------------------------

function closerLook(pick, slug) {
  console.log(`\n## Closer look: \`${pick.text}\`\n`);

  console.log("| initial density | fate | transient | period | final density | activity | structures left |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const run of pick.runs) {
    console.log(
      `| ${pct(run.density)} | ${run.fate} | ${run.enteredAt} | ${run.period || "-"} | ${pct(run.finalDensity)} | ${pct(run.activity)} | ${run.found.length} |`,
    );
  }

  const tally = new Map();
  for (const run of pick.runs) {
    for (const info of run.found) {
      const label = `${nameOf(info.key, info.kind)}|${info.kind}|${info.key}`;
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
  }
  console.log(
    `\nStructures left on the five boards, classified by simulating each one alone. Names are shape matches against the Conway catalogue, so a shape can carry a Conway name while behaving differently under this rule.\n`,
  );
  console.log("| structure | kind | count | shape |");
  console.log("| --- | --- | --- | --- |");
  for (const [label, count] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const [name, kind, key] = label.split("|");
    const art = artOf(key).join("<br>").replace(/\./g, "&middot;").replace(/#/g, "&#9632;");
    console.log(`| ${name} | ${kind} | ${count} | <code>${art}</code> |`);
  }

  if (pick.ships?.best) {
    console.log(
      `\nSmallest spaceship, from the exhaustive search over the 4x4 box: ${pick.ships.best.cells} cells, period ${pick.ships.best.period}.\n`,
    );
    console.log("```");
    for (const row of artOf(pick.ships.best.key)) console.log(row);
    console.log("```");
  }

  // A time strip for the chosen rule.
  const size = 96;
  const frames = [];
  const marks = new Set([20, 100, 800]);
  let front = createGrid(size, size);
  let back = createGrid(size, size);
  randomizeGrid(front, 0.3, mulberry32(31337));
  frames.push({ ...front, cells: front.cells.slice() });
  for (let generation = 1; generation <= 800; generation++) {
    stepInto(front, back, pick.rule, true);
    [front, back] = [back, front];
    if (marks.has(generation)) frames.push({ ...front, cells: front.cells.slice() });
  }
  writeStripPng(`${IMAGES}/${slug}-timeline.png`, frames, { scale: 3 });
  console.log(`\n<!-- figure: ${IMAGES}/${slug}-timeline.png is ${pick.text} at generations 0, ${[...marks].join(", ")} -->`);

  console.log(`\n### Density sweep for \`${pick.text}\` against Conway\n`);
  console.log("| initial density | mean final density, this rule | mean final density, B3/S23 |");
  console.log("| --- | --- | --- |");
  const conway = parseRule("B3/S23");
  for (const density of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8]) {
    const finals = (rule) =>
      mean(
        [0, 1, 2]
          .map((i) => runSoup(rule, density, 777 + i * 613, { size: 96, maxGenerations: 1200 }))
          .map((r) => r.populations[r.populations.length - 1] / 9216),
      );
    console.log(`| ${pct(density)} | ${pct(finals(pick.rule))} | ${pct(finals(conway))} |`);
  }
}

// The closer look goes to the best-scoring rule that also has a moving structure.
const best = mobile[0] ?? passing[0];
closerLook(best, "pick");

const sampleBest = [...sample].sort((a, b) => lifeLikeScore(b) - lifeLikeScore(a))[0];
console.log(
  `\nBest rule in sample B by the same score: \`${sampleBest.text}\` at ${lifeLikeScore(sampleBest).toFixed(2)}, against ${lifeLikeScore(best).toFixed(2)} for \`${best.text}\`.\n`,
);

console.log(`\n<!-- rules by class, for the report -->\n`);
for (const [klass, entries] of byClass) {
  console.log(`- **${klass}**: ${entries.map((e) => `\`${e.text}\``).join(", ")}`);
}

console.error(`rule survey finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
