import { Grid } from "./life";

export interface Pattern {
  name: string;
  /** Rule the pattern is designed for, shown as a hint in the UI. */
  rule: string;
  note: string;
  /** ASCII art rows where "#" is a live cell. */
  rows: string[];
}

export const PATTERNS: Pattern[] = [
  {
    name: "Glider",
    rule: "B3/S23",
    note: "Smallest spaceship. Moves one cell diagonally every 4 generations.",
    rows: [".#.", "..#", "###"],
  },
  {
    name: "Lightweight spaceship",
    rule: "B3/S23",
    note: "Travels straight sideways, 2 cells every 4 generations.",
    rows: [".####", "#...#", "....#", "#..#."],
  },
  {
    name: "Blinker",
    rule: "B3/S23",
    note: "Period-2 oscillator, the most common leftover of random soup.",
    rows: ["###"],
  },
  {
    name: "Pulsar",
    rule: "B3/S23",
    note: "Period-3 oscillator with 4-fold symmetry.",
    rows: [
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
    ],
  },
  {
    name: "R-pentomino",
    rule: "B3/S23",
    note: "Five cells that stay chaotic for 1103 generations before settling.",
    rows: [".##", "##.", ".#."],
  },
  {
    name: "Acorn",
    rule: "B3/S23",
    note: "Seven cells that grow for over 5000 generations.",
    rows: [".#.....", "...#...", "##..###"],
  },
  {
    name: "Gosper glider gun",
    rule: "B3/S23",
    note: "Emits a glider every 30 generations: unbounded growth from a finite seed.",
    rows: [
      "........................#...........",
      "......................#.#...........",
      "............##......##............##",
      "...........#...#....##............##",
      "##........#.....#...##..............",
      "##........#...#.##....#.#...........",
      "..........#.....#.......#...........",
      "...........#...#....................",
      "............##......................",
    ],
  },
  {
    name: "Diehard",
    rule: "B3/S23",
    note: "Seven cells that peak at 40 and then vanish completely at generation 130.",
    rows: ["......#.", "##......", ".#...###"],
  },
  {
    name: "B358 spaceship",
    rule: "B358/S126",
    note: "Six cells that travel 2 cells straight every 6 generations. Found by an exhaustive search over every pattern in a 4x4 box, under a rule found by searching the rule space in Task 3.",
    rows: ["#..#", ".##.", "##.."],
  },
  {
    name: "Replicator",
    rule: "B36/S23",
    note: "HighLife only. Every 12 generations it becomes two copies of itself, so the copy count follows Pascal's triangle mod 2 and draws a Sierpinski triangle.",
    rows: ["..###", ".#..#", "#...#", "#..#.", "###.."],
  },
];

export interface RulePreset {
  name: string;
  rule: string;
  note: string;
}

export const RULE_PRESETS: RulePreset[] = [
  { name: "Conway's Life", rule: "B3/S23", note: "The classic. Balanced between order and chaos." },
  { name: "HighLife", rule: "B36/S23", note: "Life plus birth on 6. Contains a self-replicator." },
  { name: "Day & Night", rule: "B3678/S34678", note: "Symmetric under swapping live and dead cells." },
  { name: "Seeds", rule: "B2/S", note: "Nothing survives. Explosive, spark-like growth." },
  { name: "Life without Death", rule: "B3/S012345678", note: "Cells never die. Grows coral-like mazes." },
  { name: "Maze", rule: "B3/S12345", note: "Freezes into long winding corridors." },
  { name: "Mazectric", rule: "B3/S1234", note: "Maze with straighter, longer hallways." },
  { name: "Coral", rule: "B3/S45678", note: "Slow crystalline growth with textured edges." },
  { name: "Diamoeba", rule: "B35678/S5678", note: "Large amoeba-like blobs with wandering boundaries." },
  { name: "Anneal", rule: "B4678/S35678", note: "Majority-like voting rule. Domains coarsen over time." },
  { name: "34 Life", rule: "B34/S34", note: "Active and chaotic, full of small oscillators." },
  { name: "Replicator", rule: "B1357/S1357", note: "Every pattern replicates itself fractally." },
  {
    name: "Sparse (searched)",
    rule: "B358/S126",
    note: "Found by searching the rule space in Task 3. Settles near 2% full from any starting density, and has a 6-cell spaceship.",
  },
];

/** Stamps `pattern` into `grid` with its top-left corner at (x, y). */
export function stampPattern(grid: Grid, pattern: Pattern, x: number, y: number, wrap: boolean): void {
  pattern.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] !== "#") continue;
      let px = x + dx;
      let py = y + dy;
      if (wrap) {
        px = ((px % grid.width) + grid.width) % grid.width;
        py = ((py % grid.height) + grid.height) % grid.height;
      } else if (px < 0 || py < 0 || px >= grid.width || py >= grid.height) {
        continue;
      }
      grid.cells[py * grid.width + px] = 1;
    }
  });
}

export function patternSize(pattern: Pattern): { width: number; height: number } {
  return {
    width: Math.max(...pattern.rows.map((r) => r.length)),
    height: pattern.rows.length,
  };
}
