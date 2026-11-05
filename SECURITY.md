# Security policy for this fork

This fork preserves the Unslop design workflow while treating live pages,
saved snapshots, story files, and other local users as untrusted at the helper
boundaries.

## Hardened behavior

- `snapshot.mjs` produces a static document with a restrictive CSP, removes
  embedded browsing and automatic navigation surfaces, strips event handlers
  and dangerous URL schemes, and neutralizes CSS raw-text terminators before
  serialization. Final parsing and sanitization happen in a fresh browser page,
  outside the live site's JavaScript realm.
- Assets that cannot be inlined are replaced by inert data URLs instead of
  remaining network dependencies. This can reduce visual fidelity for large or
  inaccessible resources, but keeps reopening the copy offline and inert.
- `story.mjs` protects every temporary HTTP request with a cryptographically
  random per-run header injected only for its loopback origin.
- Story assets are canonicalized with `realpath`, constrained by path
  components, required to be regular files, and served with bounded error
  handling. Root-relative and ordinary relative assets remain supported.

The story HTML itself remains trusted input for rendering: its JavaScript runs
inside the disposable Playwright browser and can request authorized assets
inside the story directory. Do not render an untrusted story beside unrelated
private files.

## Reporting

Please report security problems privately through GitHub Security Advisories
for this repository. Include the affected revision and a minimal reproducer;
do not include real credentials or private project data.

## Attribution

Original project: <https://github.com/heydamir/unslop>

Original author: Damir / `@heydamir`

License: Creative Commons Attribution 4.0 International, preserved in
[`LICENSE`](LICENSE).
