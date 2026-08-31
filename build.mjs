#!/usr/bin/env node
// HJEN Docs — static build step (zero dependencies).
//
// Reads the Markdown in ./docs and bakes it into ./public/docs.json, which the
// browser app loads directly. That makes the whole ./public folder a fully
// static site — no server needed at runtime — so it can be hosted for free on
// Cloudflare Pages, GitHub Pages, Netlify, etc.
//
//   node build.mjs      → writes public/docs.json
//
// (server.js also calls this on startup, so `node server.js` stays a one-step
// local preview.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, 'docs');
const OUT_FILE = path.join(__dirname, 'public', 'docs.json');

// Two-digit filename prefix (NN-slug.md); the first digit groups the sidebar.
const GROUPS = {
  '0': 'Start here',
  '1': 'The repositories',
  '2': 'System & security',
  '3': 'Beta launch',
  '4': 'Reference',
};

function firstHeading(md, fallback) {
  const m = md.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : fallback;
}

export function buildIndex() {
  let files = [];
  try { files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')); } catch { return []; }
  files.sort();
  return files.map((file) => {
    const slug = file.replace(/\.md$/, '');
    const markdown = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    const groupKey = (slug.match(/^(\d)/) || [])[1] || '9';
    return {
      slug,
      title: firstHeading(markdown, slug.replace(/^\d+-/, '').replace(/-/g, ' ')),
      group: GROUPS[groupKey] || 'More',
      groupKey,
      markdown,
    };
  });
}

export function writeDocsJson() {
  const docs = buildIndex();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ docs, builtAt: new Date().toISOString() }));
  return docs.length;
}

// Run directly → build once and report.
if (import.meta.url === `file://${process.argv[1]}`) {
  const n = writeDocsJson();
  console.log(`Built public/docs.json — ${n} document(s).`);
}
