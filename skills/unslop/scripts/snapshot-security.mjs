export const SNAPSHOT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "sandbox",
].join("; ");

export function neutralizeStyleRawText(css) {
  return String(css).replace(/<\/style/gi, "<\\/style");
}

export function insertCapturedStyle(html, css, marker) {
  const placeholder = `<!--${marker}-->`;
  const first = html.indexOf(placeholder);
  if (first === -1 || html.indexOf(placeholder, first + placeholder.length) !== -1) {
    throw new Error("snapshot style marker is missing or ambiguous");
  }
  return html.replace(placeholder, `<style>${neutralizeStyleRawText(css)}</style>`);
}
