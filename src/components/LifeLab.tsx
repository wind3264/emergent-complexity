"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Grid,
  Rule,
  clearGrid,
  createGrid,
  hashGrid,
  maskOf,
  parseRule,
  populationOf,
  randomizeGrid,
  resizeGrid,
  ruleToString,
  stepInto,
} from "@/lib/life";
import { PATTERNS, Pattern, patternSize, stampPattern } from "@/lib/patterns";
import RuleEditor from "./RuleEditor";

const SIZES = [
  { label: "60 x 40", cols: 60, rows: 40 },
  { label: "100 x 70", cols: 100, rows: 70 },
  { label: "160 x 110", cols: 160, rows: 110 },
  { label: "260 x 170", cols: 260, rows: 170 },
  { label: "400 x 260", cols: 400, rows: 260 },
];
const DEFAULT_SIZE = 2;

/** Generations per second offered by the speed slider. */
const SPEEDS = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60, 120];
const DEFAULT_SPEED = 6;

const MAX_STEPS_PER_FRAME = 12;
const HISTORY_LIMIT = 600;
/** Longest oscillation period the cycle detector can name. */
const CYCLE_WINDOW = 32;

const COLOR_BG = "#05070b";
const COLOR_LINE = "#141b28";
const COLOR_ALIVE = "#5eead4";
const COLOR_BORN = "#f0fdfa";

export default function LifeLab() {
  const [sizeIndex, setSizeIndex] = useState(DEFAULT_SIZE);
  const { cols, rows } = SIZES[sizeIndex];

  const [rule, setRule] = useState<Rule>({ birth: maskOf([3]), survive: maskOf([2, 3]) });
  const [running, setRunning] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED);
  const [density, setDensity] = useState(0.3);
  const [wrap, setWrap] = useState(true);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [stats, setStats] = useState({ generation: 0, population: 0, verdict: "" });
  const [hasSeed, setHasSeed] = useState(false);

  // Grids live in refs: the animation loop mutates them without re-rendering React.
  const gridRef = useRef<Grid | null>(null);
  const backRef = useRef<Grid | null>(null);
  const seedRef = useRef<Uint8Array | null>(null);
  const prevValidRef = useRef(false);
  const genRef = useRef(0);
  const popRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const cyclesRef = useRef<{ hash: string; gen: number }[]>([]);
  const verdictRef = useRef("");

  // Mirrors of React state that the animation loop reads every frame.
  const ruleRef = useRef(rule);
  const runningRef = useRef(running);
  const speedRef = useRef(SPEEDS[speedIndex]);
  const wrapRef = useRef(wrap);
  const patternRef = useRef(pattern);

  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const cellRef = useRef(4);
  const paintRef = useRef<{ value: number; x: number; y: number } | null>(null);

  if (gridRef.current === null) {
    gridRef.current = createGrid(cols, rows);
    backRef.current = createGrid(cols, rows);
  }

  useEffect(() => {
    ruleRef.current = rule;
  }, [rule]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    speedRef.current = SPEEDS[speedIndex];
  }, [speedIndex]);
  useEffect(() => {
    wrapRef.current = wrap;
  }, [wrap]);
  useEffect(() => {
    patternRef.current = pattern;
  }, [pattern]);

  /** Pushes the simulation counters into React state so the footer updates. */
  const publishStats = useCallback(() => {
    setStats({ generation: genRef.current, population: popRef.current, verdict: verdictRef.current });
  }, []);

  const drawChart = useCallback(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 168;
    const h = 34;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const history = historyRef.current;
    if (history.length < 2) return;
    const peak = Math.max(1, ...history);
    ctx.beginPath();
    history.forEach((value, i) => {
      const x = (i / (history.length - 1)) * (w - 2) + 1;
      const y = h - 2 - (value / peak) * (h - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLOR_ALIVE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cell = cellRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cell * grid.width;
    const cssH = cell * grid.height;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, cssW, cssH);

    if (cell >= 7) {
      ctx.strokeStyle = COLOR_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < grid.width; x++) {
        ctx.moveTo(x * cell + 0.5, 0);
        ctx.lineTo(x * cell + 0.5, cssH);
      }
      for (let y = 1; y < grid.height; y++) {
        ctx.moveTo(0, y * cell + 0.5);
        ctx.lineTo(cssW, y * cell + 0.5);
      }
      ctx.stroke();
    }

    // Cells that appeared this generation are drawn brighter, which makes gliders
    // and growth fronts easy to see while the simulation runs.
    const cells = grid.cells;
    const prev = prevValidRef.current ? backRef.current!.cells : null;
    const size = cell >= 4 ? cell - 1 : cell;

    ctx.fillStyle = COLOR_ALIVE;
    for (let y = 0, i = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++, i++) {
        if (cells[i] && (!prev || prev[i])) ctx.fillRect(x * cell, y * cell, size, size);
      }
    }
    if (prev) {
      ctx.fillStyle = COLOR_BORN;
      for (let y = 0, i = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++, i++) {
          if (cells[i] && !prev[i]) ctx.fillRect(x * cell, y * cell, size, size);
        }
      }
    }
  }, []);

  /** Clears run history. Called whenever the board is edited or re-seeded. */
  const resetRun = useCallback((population: number) => {
    genRef.current = 0;
    popRef.current = population;
    historyRef.current = [population];
    cyclesRef.current = [];
    verdictRef.current = "";
    seedRef.current = null;
    prevValidRef.current = false;
    setHasSeed(false);
  }, []);

  /** Advances one generation, swapping the front and back buffers. */
  const advance = useCallback(() => {
    const grid = gridRef.current!;
    const back = backRef.current!;
    if (genRef.current === 0 && seedRef.current === null) {
      seedRef.current = grid.cells.slice();
      setHasSeed(true);
    }
    // Record the starting board so a period-2 oscillator is caught on its
    // second step rather than its third.
    if (cyclesRef.current.length === 0) {
      cyclesRef.current.push({ hash: hashGrid(grid), gen: genRef.current });
    }

    popRef.current = stepInto(grid, back, ruleRef.current, wrapRef.current);
    gridRef.current = back;
    backRef.current = grid;
    prevValidRef.current = true;
    genRef.current += 1;

    const history = historyRef.current;
    history.push(popRef.current);
    if (history.length > HISTORY_LIMIT) history.shift();

    if (popRef.current === 0) {
      verdictRef.current = "extinct";
      runningRef.current = false;
      setRunning(false);
      return;
    }

    const hash = hashGrid(gridRef.current);
    const seen = cyclesRef.current;
    const match = seen.find((entry) => entry.hash === hash);
    if (match) {
      const period = genRef.current - match.gen;
      verdictRef.current = period === 1 ? "frozen (still life)" : `cycle of period ${period}`;
    } else {
      verdictRef.current = "";
    }
    seen.push({ hash, gen: genRef.current });
    if (seen.length > CYCLE_WINDOW) seen.shift();
  }, []);

  // Animation loop. Runs for the lifetime of the component and reads refs only.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let lastPublish = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      last = now;
      if (!runningRef.current) return;

      const interval = 1000 / speedRef.current;
      accumulator = Math.min(accumulator + dt, interval * MAX_STEPS_PER_FRAME);
      let steps = 0;
      while (accumulator >= interval && steps < MAX_STEPS_PER_FRAME && runningRef.current) {
        accumulator -= interval;
        advance();
        steps++;
      }
      if (steps > 0) {
        draw();
        if (now - lastPublish > 90 || !runningRef.current) {
          lastPublish = now;
          publishStats();
          drawChart();
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [advance, draw, drawChart, publishStats]);

  // Fit the board to the available space whenever the container or grid size changes.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const fit = () => {
      const rect = board.getBoundingClientRect();
      const cell = Math.max(1, Math.floor(Math.min((rect.width - 2) / cols, (rect.height - 2) / rows)));
      if (cell !== cellRef.current) {
        cellRef.current = cell;
        draw();
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(board);
    return () => observer.disconnect();
  }, [cols, rows, draw]);

  // Seed the first board with a random soup so there is something to watch.
  useEffect(() => {
    const grid = gridRef.current!;
    randomizeGrid(grid, 0.3);
    resetRun(populationOf(grid));
    draw();
    publishStats();
    drawChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-allocate the buffers when the user picks a different board size.
  useEffect(() => {
    const grid = gridRef.current!;
    if (grid.width === cols && grid.height === rows) return;
    const resized = resizeGrid(grid, cols, rows);
    gridRef.current = resized;
    backRef.current = createGrid(cols, rows);
    resetRun(populationOf(resized));
    draw();
    publishStats();
    drawChart();
  }, [cols, rows, draw, drawChart, publishStats, resetRun]);

  const doStep = useCallback(() => {
    advance();
    draw();
    publishStats();
    drawChart();
  }, [advance, draw, drawChart, publishStats]);

  const doRandomize = useCallback(() => {
    const grid = gridRef.current!;
    randomizeGrid(grid, density);
    resetRun(populationOf(grid));
    draw();
    publishStats();
    drawChart();
  }, [density, draw, drawChart, publishStats, resetRun]);

  const doClear = useCallback(() => {
    setRunning(false);
    clearGrid(gridRef.current!);
    resetRun(0);
    draw();
    publishStats();
    drawChart();
  }, [draw, drawChart, publishStats, resetRun]);

  /** Restores the board to the configuration it had at generation 0. */
  const doReset = useCallback(() => {
    const seed = seedRef.current;
    if (!seed) return;
    setRunning(false);
    gridRef.current!.cells.set(seed);
    const population = populationOf(gridRef.current!);
    resetRun(population);
    seedRef.current = seed;
    setHasSeed(true);
    draw();
    publishStats();
    drawChart();
  }, [draw, drawChart, publishStats, resetRun]);

  /**
   * Records a hand edit. The generation counter keeps running, but the cycle
   * detector and the birth highlight are invalidated because the board changed
   * for reasons the rule did not cause.
   */
  const noteEdit = useCallback(() => {
    popRef.current = populationOf(gridRef.current!);
    cyclesRef.current = [];
    verdictRef.current = "";
    prevValidRef.current = false;
    draw();
    publishStats();
    drawChart();
  }, [draw, drawChart, publishStats]);

  function cellAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / cellRef.current);
    const y = Math.floor((clientY - rect.top) / cellRef.current);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
    return { x, y };
  }

  function paintCell(x: number, y: number, value: number) {
    const grid = gridRef.current!;
    grid.cells[y * grid.width + x] = value;
  }

  /** Fills the gap between two drag samples so fast strokes stay connected. */
  function paintLine(x0: number, y0: number, x1: number, y1: number, value: number) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      paintCell(x, y, value);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const at = cellAt(e.clientX, e.clientY);
    if (!at) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const active = patternRef.current;
    if (active) {
      const { width, height } = patternSize(active);
      stampPattern(
        gridRef.current!,
        active,
        at.x - Math.floor(width / 2),
        at.y - Math.floor(height / 2),
        wrapRef.current,
      );
      noteEdit();
      return;
    }

    const grid = gridRef.current!;
    // Right-click or shift erases; otherwise the stroke takes the opposite of the
    // cell you started on, so tapping a live cell erases and a dead cell draws.
    const erase = e.button === 2 || e.shiftKey;
    const value = erase ? 0 : grid.cells[at.y * grid.width + at.x] ? 0 : 1;
    paintRef.current = { value, x: at.x, y: at.y };
    paintCell(at.x, at.y, value);
    noteEdit();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = paintRef.current;
    if (!stroke) return;
    const at = cellAt(e.clientX, e.clientY);
    if (!at || (at.x === stroke.x && at.y === stroke.y)) return;
    paintLine(stroke.x, stroke.y, at.x, at.y, stroke.value);
    stroke.x = at.x;
    stroke.y = at.y;
    noteEdit();
  }

  function endStroke() {
    paintRef.current = null;
  }

  // Keyboard shortcuts, ignored while a text field or select has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          setRunning((value) => !value);
          break;
        case "ArrowRight":
        case ".":
          e.preventDefault();
          setRunning(false);
          doStep();
          break;
        case "r":
          doRandomize();
          break;
        case "c":
          doClear();
          break;
        case "Escape":
          setPattern(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doStep, doRandomize, doClear]);

  const total = cols * rows;
  const ruleName = ruleToString(rule);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Life Lab</h1>
        <span className="tag">{ruleName}</span>
        <span className="spacer" />
        <a href="https://github.com/wind3264/emergent-complexity" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </header>

      <div className="layout">
        <main className="stage">
          <div className={`board ${pattern ? "stamping" : ""}`} ref={boardRef}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>

          <div className="stagefoot">
            <span className="stat">
              generation <b>{stats.generation}</b>
            </span>
            <span className="stat">
              population <b>{stats.population}</b>
            </span>
            <span className="stat">
              density <b>{((stats.population / total) * 100).toFixed(1)}%</b>
            </span>
            {stats.verdict && (
              <span className="stat">
                state <b className="verdict">{stats.verdict}</b>
              </span>
            )}
            <canvas className="chart" ref={chartRef} title="Population over the last 600 generations" />
          </div>
        </main>

        <aside className="sidebar">
          <div className="panel">
            <h2>Simulation</h2>
            <div className="row">
              <button className="btn primary wide" onClick={() => setRunning((v) => !v)}>
                {running ? "Pause" : "Play"}
              </button>
              <button
                className="btn wide"
                onClick={() => {
                  setRunning(false);
                  doStep();
                }}
              >
                Step
              </button>
            </div>
            <div className="row">
              <button className="btn wide" onClick={doRandomize}>
                Randomize
              </button>
              <button className="btn wide" onClick={doClear}>
                Clear
              </button>
              <button className="btn wide" onClick={doReset} disabled={!hasSeed}>
                Reset
              </button>
            </div>

            <div className="row" style={{ display: "block", marginTop: 12 }}>
              <label className="field" htmlFor="speed">
                Speed <b>{SPEEDS[speedIndex]}</b> gen/s
              </label>
              <input
                id="speed"
                type="range"
                min={0}
                max={SPEEDS.length - 1}
                step={1}
                value={speedIndex}
                onChange={(e) => setSpeedIndex(Number(e.target.value))}
              />
            </div>

            <div className="row" style={{ display: "block" }}>
              <label className="field" htmlFor="density">
                Random fill density <b>{Math.round(density * 100)}%</b>
              </label>
              <input
                id="density"
                type="range"
                min={1}
                max={99}
                step={1}
                value={Math.round(density * 100)}
                onChange={(e) => setDensity(Number(e.target.value) / 100)}
              />
            </div>

            <p className="hint">
              <kbd>space</kbd> play/pause &nbsp; <kbd>&rarr;</kbd> step &nbsp; <kbd>r</kbd> randomize &nbsp;{" "}
              <kbd>c</kbd> clear
            </p>
          </div>

          <RuleEditor rule={rule} onChange={setRule} />

          <div className="panel">
            <h2>Board</h2>
            <div className="row" style={{ display: "block" }}>
              <label className="field" htmlFor="size">
                Grid size
              </label>
              <select id="size" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
                {SIZES.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label} ({(s.cols * s.rows).toLocaleString()} cells)
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="check">
                <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
                Wrap edges (torus)
              </label>
            </div>
            <div className="legend" style={{ marginTop: 11 }}>
              <span>
                <i style={{ background: COLOR_ALIVE }} /> alive
              </span>
              <span>
                <i style={{ background: COLOR_BORN }} /> born this step
              </span>
            </div>
          </div>

          <div className="panel">
            <h2>Stamp a pattern</h2>
            <div className="patterns">
              <button
                className={`chip ${pattern === null ? "active" : ""}`}
                onClick={() => setPattern(null)}
              >
                Draw
              </button>
              {PATTERNS.map((p) => (
                <button
                  key={p.name}
                  className={`chip ${pattern?.name === p.name ? "active" : ""}`}
                  title={`${p.rule}: ${p.note}`}
                  onClick={() => setPattern(pattern?.name === p.name ? null : p)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="hint">
              {pattern ? (
                <>
                  <b>{pattern.name}</b> ({pattern.rule}): {pattern.note} Click the board to place it.{" "}
                  {pattern.rule !== ruleName && (
                    <button
                      className="chip"
                      style={{ marginTop: 6 }}
                      onClick={() => {
                        const parsed = parseRule(pattern.rule);
                        if (parsed) setRule(parsed);
                      }}
                    >
                      Switch to {pattern.rule}
                    </button>
                  )}
                </>
              ) : (
                "Drag on the board to draw. Shift-drag or right-drag erases."
              )}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
