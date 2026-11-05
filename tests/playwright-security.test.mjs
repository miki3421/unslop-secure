import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

import {
  authorizeStoryPage,
  createRunCapability,
  createStoryServer,
} from "../skills/unslop/scripts/story-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "..");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

function runNode(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

test("snapshot resists hostile DOM prototypes and active CSS", { skip: !executablePath }, async (t) => {
  const output = mkdtempSync(join(tmpdir(), "unslop-snapshot-e2e-"));
  const server = createServer((request, response) => {
    if (request.url === "/evil.css") {
      response.writeHead(200, { "content-type": "text/css" });
      return response.end("body { color: rgb(1, 2, 3) } /* </STYLE><script>document.documentElement.dataset.cssExecuted='yes'</script> */");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/evil.css"><script>
      const nativeOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML").get;
      Object.defineProperty(Element.prototype, "outerHTML", { get() {
        const value = nativeOuterHTML.call(this);
        const marker = value.match(/<!--(unslop-captured-style-[a-f0-9-]+)-->/)?.[1];
        return marker ? '<html><head><!--' + marker + '--></head><body><script>document.documentElement.dataset.prototypeExecuted="yes"<\\/script></body></html>' : value;
      }});
    </script></head><body onload="window.liveOnly=true"><div id="result">safe</div></body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    rmSync(output, { recursive: true, force: true });
  });

  const snapshotPath = join(output, "snapshot.html");
  const result = await runNode([
    join(repository, "skills/unslop/scripts/snapshot.mjs"),
    `http://127.0.0.1:${server.address().port}/`,
    snapshotPath,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, CHROME_PATH: executablePath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const saved = readFileSync(snapshotPath, "utf8");
  assert.match(saved, /Content-Security-Policy/);
  assert.doesNotMatch(saved, /onload=/i);
  assert.doesNotMatch(saved, /<\/style><script>/i);

  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`file://${snapshotPath}`);
  assert.equal(await page.locator("#result").textContent(), "safe");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.cssExecuted), undefined);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.prototypeExecuted), undefined);
  assert.equal(await page.evaluate(() => window.liveOnly), undefined);
});

test("Playwright capability injection preserves relative and root-relative story assets", { skip: !executablePath }, async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "unslop-story-e2e-"));
  const root = join(workspace, "story");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "story.html"), '<!doctype html><link rel="stylesheet" href="/assets/site.css"><div id="story">loaded</div>');
  writeFileSync(join(root, "assets/site.css"), "#story { color: rgb(1, 2, 3) }");

  const stage = '<!doctype html><iframe id="page" src="/__story/story.html"></iframe>';
  const capability = createRunCapability();
  const server = createStoryServer({ root, stage, capability });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    rmSync(workspace, { recursive: true, force: true });
  });

  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await authorizeStoryPage(page, base, capability);
  await page.goto(`${base}/__stage.html`);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  await frame.waitForSelector("#story");
  assert.equal(await frame.locator("#story").textContent(), "loaded");
  assert.equal(await frame.locator("#story").evaluate((node) => getComputedStyle(node).color), "rgb(1, 2, 3)");
});
