import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  insertCapturedStyle,
  neutralizeStyleRawText,
  SNAPSHOT_CSP,
} from "../skills/unslop/scripts/snapshot-security.mjs";
import {
  createRunCapability,
  createStoryServer,
} from "../skills/unslop/scripts/story-server.mjs";

function request(server, path, capability) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      headers: capability ? { "x-unslop-capability": capability } : {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("snapshot CSS cannot terminate its generated style element", () => {
  const css = "body { color: red } /* </STYLE><script>globalThis.pwned = true</script> */";
  const safe = neutralizeStyleRawText(css);
  assert.doesNotMatch(safe, /<\/style/i);

  const html = insertCapturedStyle(
    "<!doctype html><html><head><!--capture-marker--></head><body></body></html>",
    css,
    "capture-marker",
  );
  assert.match(html, /<style>body \{ color: red \}/);
  assert.doesNotMatch(html, /<\/style><script>/i);
});

test("snapshot insertion fails closed when its marker is missing or ambiguous", () => {
  assert.throws(() => insertCapturedStyle("<html></html>", "body{}", "missing"));
  assert.throws(() => insertCapturedStyle("<!--same--><!--same-->", "body{}", "same"));
  assert.match(SNAPSHOT_CSP, /default-src 'none'/);
  assert.match(SNAPSHOT_CSP, /connect-src 'none'/);
  assert.match(SNAPSHOT_CSP, /frame-src 'none'/);
  assert.match(SNAPSHOT_CSP, /form-action 'none'/);
  assert.match(SNAPSHOT_CSP, /(?:^|; )sandbox(?:;|$)/);
});

test("snapshot CLI installs CSP and removes active DOM surfaces", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../skills/unslop/scripts/snapshot.mjs"), "utf8");
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /const sanitizer = await browser\.newPage\(\)/);
  assert.match(source, /new DOMParser\(\)\.parseFromString/);
  assert.ok(
    source.indexOf("const marker = `unslop-captured-style-") > source.indexOf('}, [label ?? "", scheme]);'),
    "the hostile page must return before the trusted marker is created",
  );
  assert.match(source, /iframe, frame, frameset, object, embed, base/);
  assert.match(source, /name\.startsWith\("on"\)/);
  assert.match(source, /javascript\|vbscript/);
});

test("story server enforces capability, canonical containment and bounded errors", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "unslop-story-security-"));
  const root = join(workspace, "story");
  const sibling = join(workspace, "story-private");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(sibling);
  writeFileSync(join(root, "story.html"), "<html>story</html>");
  writeFileSync(join(root, "assets/site.css"), "body { color: green }");
  writeFileSync(join(sibling, "secret.txt"), "sibling secret");
  symlinkSync(join(sibling, "secret.txt"), join(root, "escape.txt"));

  const capability = createRunCapability();
  const server = createStoryServer({ root, stage: "<html>stage</html>", capability });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  });

  assert.equal((await request(server, "/__stage.html")).status, 403);
  assert.equal((await request(server, "/__stage.html", "wrong")).status, 403);
  assert.equal((await request(server, "/__stage.html", capability)).status, 200);

  const relative = await request(server, "/__story/assets/site.css", capability);
  assert.equal(relative.status, 200);
  assert.equal(relative.body, "body { color: green }");
  assert.equal(relative.headers["x-content-type-options"], "nosniff");

  const rootRelative = await request(server, "/assets/site.css", capability);
  assert.equal(rootRelative.status, 200);
  assert.equal(rootRelative.body, "body { color: green }");

  assert.equal((await request(server, "/__story/..%2fstory-private%2fsecret.txt", capability)).status, 404);
  assert.equal((await request(server, "/__story/escape.txt", capability)).status, 404);
  assert.equal((await request(server, "/__story/%ZZ", capability)).status, 400);
  assert.equal((await request(server, "/", capability)).status, 404);

  const afterErrors = await request(server, "/__story/story.html", capability);
  assert.equal(afterErrors.status, 200);
  assert.equal(afterErrors.body, "<html>story</html>");
});

test("story capabilities are unpredictable per run", () => {
  const first = createRunCapability();
  const second = createRunCapability();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});
