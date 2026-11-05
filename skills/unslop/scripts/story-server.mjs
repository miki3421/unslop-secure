import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
};

export function createRunCapability() {
  return randomBytes(32).toString("hex");
}

function deny(response, status) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

export function isInsideRoot(root, target) {
  const path = relative(root, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function createStoryServer({ root, stage, capability }) {
  if (!capability) throw new Error("story server capability is required");
  const canonicalRoot = realpathSync(root);

  return createServer((request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return deny(response, 405);
      if (request.headers["x-unslop-capability"] !== capability) return deny(response, 403);

      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
      } catch {
        return deny(response, 400);
      }
      if (pathname.includes("\0")) return deny(response, 400);

      if (pathname === "/__stage.html") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
        });
        return response.end(request.method === "HEAD" ? undefined : stage);
      }

      const assetPath = pathname.startsWith("/__story/")
        ? pathname.slice("/__story/".length)
        : pathname.replace(/^\/+/, "");
      const candidate = resolve(canonicalRoot, assetPath);
      if (!existsSync(candidate)) return deny(response, 404);

      let target;
      try {
        target = realpathSync(candidate);
      } catch {
        return deny(response, 404);
      }
      if (!isInsideRoot(canonicalRoot, target) || !statSync(target).isFile()) return deny(response, 404);

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : readFileSync(target));
    } catch {
      if (!response.headersSent) return deny(response, 404);
      response.destroy();
    }
  });
}
