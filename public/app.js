// HJEN Docs — client. Fetches Markdown from the zero-dep server, renders it, and
// wires up the sidebar, hash routing, table of contents, and full-text search.

let DOCS = [];

// ── a small, dependency-free Markdown → HTML renderer ────────────────────────
// Handles the subset the docs use: headings, fenced code, tables, lists (nested),
// blockquotes, hr, inline code/bold/italic/links, and paragraphs. Everything is
// HTML-escaped first so nothing in the Markdown can inject markup.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(text) {
  let t = escapeHtml(text);
  // inline code first, protected with placeholders so ** and * inside code survive
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  // links [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safe = /^(https?:|mailto:|#|\/)/.test(url) ? url : '#';
    const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${safe}"${ext}>${label}</a>`;
  });
  // bold, then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // severity pills: {sev:critical} style tokens
  t = t.replace(/\{sev:(critical|high|medium|low|info)\}/gi, (_, s) =>
    `<span class="sev sev-${s.toLowerCase()}">${s.toUpperCase()}</span>`);
  // restore inline code
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  const headings = [];

  const closeList = (stack) => { while (stack.length) html += stack.pop().type === 'ul' ? '</ul>' : '</ol>'; };
  let listStack = [];

  while (i < lines.length) {
    let line = lines[i];

    // fenced code block
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      closeList(listStack); listStack = [];
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume closing fence
      html += `<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`;
      continue;
    }

    // table: a header line followed by a |---|---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList(listStack); listStack = [];
      const parseRow = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = parseRow(lines[i]);
        body += '<tr>' + cells.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>';
        i++;
      }
      html += '<table><thead><tr>' + header.map((h) => `<th>${renderInline(h)}</th>`).join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
      continue;
    }

    // headings
    const h = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (h) {
      closeList(listStack); listStack = [];
      const level = h[1].length;
      const text = h[2];
      const id = slugify(text);
      if (level === 1 || level === 2 || level === 3) headings.push({ level, text, id });
      html += `<h${level} id="${id}">${renderInline(text)}</h${level}>`;
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList(listStack); listStack = [];
      html += '<hr />';
      i++;
      continue;
    }

    // blockquote (consume consecutive > lines)
    if (/^\s*>\s?/.test(line)) {
      closeList(listStack); listStack = [];
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html += `<blockquote>${renderMarkdown(buf.join('\n')).html}</blockquote>`;
      continue;
    }

    // list item (ordered or unordered), with indentation-based nesting
    const li = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (li) {
      const indent = li[1].length;
      const ordered = /\d+\./.test(li[2]);
      const type = ordered ? 'ol' : 'ul';
      const depth = Math.floor(indent / 2);
      while (listStack.length > depth + 1) html += listStack.pop().type === 'ul' ? '</ul>' : '</ol>';
      if (listStack.length < depth + 1) {
        html += type === 'ul' ? '<ul>' : '<ol>';
        listStack.push({ type });
      } else if (listStack.length && listStack[listStack.length - 1].type !== type) {
        html += listStack.pop().type === 'ul' ? '</ul>' : '</ol>';
        html += type === 'ul' ? '<ul>' : '<ol>';
        listStack.push({ type });
      }
      html += `<li>${renderInline(li[3])}</li>`;
      i++;
      continue;
    } else if (listStack.length && line.trim() === '') {
      // blank line may separate list from following content; peek ahead
      if (i + 1 < lines.length && /^(\s*)([-*+]|\d+\.)\s+/.test(lines[i + 1])) { i++; continue; }
      closeList(listStack); listStack = [];
      i++;
      continue;
    }

    // blank line
    if (line.trim() === '') { i++; continue; }

    // paragraph (gather until blank / block start)
    closeList(listStack); listStack = [];
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !/^```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])
      && !/^\s*>/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s/.test(lines[i])
      && !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
      && !(/^\s*\|.*\|\s*$/.test(lines[i]))) {
      buf.push(lines[i]); i++;
    }
    html += `<p>${renderInline(buf.join(' '))}</p>`;
  }
  closeList(listStack);
  return { html, headings };
}

// ── data ─────────────────────────────────────────────────────────────────────
async function loadDocs() {
  // The site is static: everything (list, content, search) comes from one
  // baked docs.json. Relative path so it works at any base path (root or a
  // /repo/ subpath on GitHub Pages).
  const res = await fetch('./docs.json');
  const data = await res.json();
  DOCS = data.docs;
  renderNav();
}

function renderNav(activeSlug) {
  const nav = document.getElementById('nav');
  const groups = {};
  const order = [];
  for (const d of DOCS) {
    if (!groups[d.group]) { groups[d.group] = []; order.push(d.group); }
    groups[d.group].push(d);
  }
  nav.innerHTML = order.map((g) => `
    <div class="nav-group">
      <h3>${escapeHtml(g)}</h3>
      ${groups[g].map((d) => `<a class="nav-item ${d.slug === activeSlug ? 'active' : ''}" href="#${d.slug}">${escapeHtml(d.title)}</a>`).join('')}
    </div>`).join('');
}

async function openDoc(slug) {
  const reader = document.getElementById('reader');
  const doc = DOCS.find((d) => d.slug === slug);
  if (!doc) { reader.innerHTML = '<p>Document not found.</p>'; return; }
  const { html, headings } = renderMarkdown(doc.markdown);

  const idx = DOCS.findIndex((d) => d.slug === slug);
  const prev = DOCS[idx - 1];
  const next = DOCS[idx + 1];
  const navHtml = `<div class="doc-nav">
    ${prev ? `<a href="#${prev.slug}"><div class="dir">← Previous</div><div class="t">${escapeHtml(prev.title)}</div></a>` : '<span></span>'}
    ${next ? `<a class="next" href="#${next.slug}"><div class="dir">Next →</div><div class="t">${escapeHtml(next.title)}</div></a>` : '<span></span>'}
  </div>`;

  reader.innerHTML = `<article class="md">${html}</article>${navHtml}`;
  reader.scrollTop = 0;
  window.scrollTo(0, 0);
  renderNav(slug);
  renderToc(headings);
  document.title = doc.title + ' — HJEN Docs';
  closeSidebar();
}

function renderToc(headings) {
  const toc = document.getElementById('toc');
  const items = headings.filter((h) => h.level === 2 || h.level === 3);
  if (items.length < 2) { toc.innerHTML = ''; return; }
  toc.innerHTML = '<h4>On this page</h4>' + items.map((h) =>
    `<a class="${h.level === 3 ? 'h3' : ''}" href="#${location.hash.slice(1).split('::')[0]}::${h.id}" data-id="${h.id}">${escapeHtml(h.text)}</a>`).join('');
}

// ── search ───────────────────────────────────────────────────────────────────
let searchTimer = null;
function markTerms(text, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let out = escapeHtml(text);
  for (const t of terms) {
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

// Client-side full-text search over the loaded corpus (tiny — a dozen docs —
// so a straight scan is instant). Mirrors the previous server-side scoring:
// term frequency in the body, a boost for title matches, and up to 3 snippets.
function searchDocs(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const doc of DOCS) {
    const lower = doc.markdown.toLowerCase();
    let score = 0;
    for (const t of terms) { let i = 0; while ((i = lower.indexOf(t, i)) !== -1) { score++; i += t.length; } }
    const titleLower = doc.title.toLowerCase();
    for (const t of terms) if (titleLower.includes(t)) score += 8;
    if (score === 0) continue;
    const lines = doc.markdown.split('\n');
    const snippets = [];
    for (let i = 0; i < lines.length && snippets.length < 3; i++) {
      const lineLower = lines[i].toLowerCase();
      if (terms.some((t) => lineLower.includes(t))) {
        const clean = lines[i].replace(/^#+\s*/, '').replace(/[*`>|]/g, '').trim();
        if (clean.length > 2) snippets.push(clean.slice(0, 220));
      }
    }
    out.push({ slug: doc.slug, title: doc.title, group: doc.group, score, snippets });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 30);
}

function runSearch(q) {
  const reader = document.getElementById('reader');
  document.getElementById('toc').innerHTML = '';
  const results = searchDocs(q);
  if (!results.length) {
    reader.innerHTML = `<div class="results"><h2>No matches for “${escapeHtml(q)}”.</h2></div>`;
    return;
  }
  reader.innerHTML = `<div class="results"><h2>${results.length} result${results.length > 1 ? 's' : ''} for “${escapeHtml(q)}”</h2>` +
    results.map((r) => `
      <a class="result" href="#${r.slug}">
        <div class="r-title">${markTerms(r.title, q)}</div>
        <div class="r-group">${escapeHtml(r.group)}</div>
        ${r.snippets.map((s) => `<div class="r-snippet">${markTerms(s, q)}</div>`).join('')}
      </a>`).join('') + '</div>';
}

// ── routing ──────────────────────────────────────────────────────────────────
function handleRoute() {
  const hash = location.hash.slice(1);
  if (!hash) { if (DOCS.length) location.hash = DOCS[0].slug; return; }
  const [slug, anchor] = hash.split('::');
  const active = document.querySelector('.reader .md');
  const currentSlug = document.body.getAttribute('data-slug');
  if (slug !== currentSlug) {
    document.body.setAttribute('data-slug', slug);
    openDoc(slug).then(() => { if (anchor) scrollToAnchor(anchor); });
  } else if (anchor) {
    scrollToAnchor(anchor);
  }
}

function scrollToAnchor(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── sidebar (mobile) ─────────────────────────────────────────────────────────
function openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('backdrop').classList.add('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('backdrop').classList.remove('show'); }

// ── boot ─────────────────────────────────────────────────────────────────────
(async function () {
  await loadDocs();

  const search = document.getElementById('search');
  search.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!q) { handleRoute(); return; }
    searchTimer = setTimeout(() => runSearch(q), 160);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; handleRoute(); }
  });

  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('backdrop').addEventListener('click', closeSidebar);

  window.addEventListener('hashchange', () => {
    if (search.value.trim()) { search.value = ''; }
    handleRoute();
  });

  handleRoute();
})();
