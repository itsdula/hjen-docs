#!/usr/bin/env node
// HJEN Docs — local preview server (zero dependencies).
//
// The site is fully static: `build.mjs` bakes the Markdown into
// public/docs.json and the browser does listing, rendering, and search itself.
// This server just (1) runs that build so the file is fresh, and (2) serves the
// ./public folder over http for local viewing.
//
//   node server.js            → http://localhost:4321
//   PORT=8080 node server.js  → custom port
//
// To DEPLOY, you don't need this server at all — run `node build.mjs` and host
// the ./public folder on any static host (see README.md).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDocsJson } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  const clean = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  // Confine to PUBLIC_DIR — strip traversal, then verify the resolved path.
  const safe = path.normalize(clean).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Bake docs.json before serving so local preview always shows the latest.
const count = writeDocsJson();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  HJEN Docs  →  http://localhost:${PORT}`);
  console.log(`  Serving ${count} document(s) as a static site from ${PUBLIC_DIR}\n`);
});
