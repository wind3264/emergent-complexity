/**
 * Takes the screenshots of the running site used in the report.
 *
 * Serves the static export in `out/` and drives a headless browser over it, so
 * the figures are reproducible rather than hand-captured.
 *
 * Drives a locally installed Chrome, so it needs one; everything else in the
 * repository runs without it.
 *
 *   npm run build
 *   node scripts/screenshots.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = "out";
const IMAGES = "docs/images";
const PORT = 4321;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const candidates = [join(ROOT, normalize(path)), join(ROOT, normalize(path), "index.html"), join(ROOT, `${normalize(path)}.html`)];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // try the next candidate
    }
  }
  res.writeHead(404).end("not found");
});

await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await puppeteer.launch({
  channel: "chrome",
  headless: true,
  args: ["--force-device-scale-factor=2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0" });

/** Drives the controls by their visible labels, the way a user would. */
async function click(label) {
  await page.evaluate((text) => {
    const target = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    if (!target) throw new Error(`no button labelled ${text}`);
    target.click();
  }, label);
}

async function setSlider(id, value) {
  await page.evaluate(
    (selector, next) => {
      const input = document.getElementById(selector);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    id,
    value,
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. The noise panel, with the board running under noise.
await setSlider("noise", 8); // 0.002 per cell per step
await setSlider("speed", 10);
await click("Play");
await wait(6000);
await click("Pause");
await page.screenshot({ path: `${IMAGES}/noise-ui.png` });

// 2. The noise panel on its own.
const panel = await page.evaluateHandle(() =>
  [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h2")?.textContent === "Noise"),
);
await panel.asElement().screenshot({ path: `${IMAGES}/noise-panel.png` });

await browser.close();
server.close();
console.log("screenshots written to docs/images");
