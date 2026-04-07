import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhm = new NodeHtmlMarkdown({
  maxConsecutiveNewlines: 2,
  bulletMarker: '-',
  ignore: ['button', 'input', 'select', 'textarea', 'label'],
});

// ─── Structured Data Extraction ─────────────────────────────────
// Extracts product data from script tags BEFORE they get stripped by htmlToMarkdown.
// Returns a markdown string to prepend to the cleaned content, or '' if nothing found.

const INLINE_MARKERS = [
  '"itemList":{"content":[',  // AliExpress
];

function extractInlineJsonArray(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const arrayStart = idx + marker.length - 1; // points to the opening '['
  if (html[arrayStart] !== '[') return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  const limit = Math.min(html.length, arrayStart + 800_000);

  for (let i = arrayStart; i < limit; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(arrayStart, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function extractStructuredData(html) {
  const sections = [];

  // Method 1: JSON-LD — most reliable, supported by schema.org
  const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonLdRe)) {
    try {
      const data = JSON.parse(match[1].trim());
      const type = data['@type'];
      if (['ItemList', 'Product', 'SearchResultsPage'].includes(type)) {
        const items = data.itemListElement || data.items || [data];
        if (items.length) {
          sections.push(`## Structured Data (JSON-LD: ${type})\n${JSON.stringify(items.slice(0, 50), null, 2)}`);
        }
      }
    } catch { /* skip invalid */ }
  }

  // Method 2: __NEXT_DATA__ — Next.js sites (Falabella, Homecenter, etc.)
  const nextDataMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1].trim());
      const products = (
        data?.props?.pageProps?.initialData?.data?.result ||
        data?.props?.pageProps?.products ||
        data?.props?.pageProps?.items ||
        data?.props?.pageProps?.searchResult?.products
      );
      if (Array.isArray(products) && products.length > 0) {
        sections.push(`## Structured Data (__NEXT_DATA__)\n${JSON.stringify(products.slice(0, 50), null, 2)}`);
      }
    } catch { /* skip */ }
  }

  // Method 3: Inline markers (AliExpress and similar SPAs)
  for (const marker of INLINE_MARKERS) {
    const items = extractInlineJsonArray(html, marker);
    if (Array.isArray(items) && items.length > 0) {
      sections.push(`## Structured Data (inline)\n${JSON.stringify(items.slice(0, 50), null, 2)}`);
      break; // one match is enough
    }
  }

  return sections.length ? sections.join('\n\n') : '';
}

const STRIP_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg'];

const STRIP_SELECTORS = [
  // Layout chrome
  'nav', 'footer', 'header', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[role="search"]',
  // Cookie / ad / social
  '.cookie-banner', '.cookie-consent', '#cookie-consent',
  '.ad', '.ads', '.advertisement', '[data-ad]',
  '.social-share', '.share-buttons',
  // Search page noise
  '.breadcrumb', '[aria-label="breadcrumb"]', 'ol.breadcrumb',
  '.sidebar', '.filters', '.facets', '.refinements',
  '.pagination', '.pager', '[aria-label="pagination"]',
  // Hidden / decorative
  '[aria-hidden="true"]',
  '[hidden]',
  '.sr-only', '.visually-hidden', '.screen-reader-text',
  '[style*="display:none"]', '[style*="display: none"]',
  // Interactive noise
  'form', 'fieldset',
  // Media without textual content
  'picture', 'video', 'audio', 'canvas',
  // E-commerce boilerplate
  '[class*="skeleton"]', '[class*="placeholder"]',
  '.tooltip', '[role="tooltip"]',
];

function cleanMarkdownUrls(md) {
  // Strip tracking params from markdown links: [text](url#tracking) → [text](cleanUrl)
  return md.replace(
    /\]\((https?:\/\/[^)]+)\)/g,
    (match, url) => {
      try {
        const u = new URL(url);
        // Remove tracking fragments
        u.hash = '';
        // Remove known tracking params
        const trackParams = ['polycard_client', 'search_layout', 'position', 'type',
          'tracking_id', 'wid', 'sid', 'applied_filter_id', 'applied_filter_name',
          'applied_filter_order', 'applied_value_id', 'applied_value_name',
          'applied_value_order', 'applied_value_results', 'is_custom',
          'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
          'ref', 'fbclid', 'gclid', 'srsltid', 'cb'];
        for (const p of trackParams) u.searchParams.delete(p);
        return `](${u.toString()})`;
      } catch {
        return match;
      }
    }
  );
}

function stripUnwantedElements(doc) {
  for (const tag of STRIP_TAGS) {
    for (const el of doc.querySelectorAll(tag)) {
      el.remove();
    }
  }

  for (const selector of STRIP_SELECTORS) {
    try {
      for (const el of doc.querySelectorAll(selector)) {
        el.remove();
      }
    } catch {
      // invalid selector for this DOM — skip
    }
  }
}

function removeEmptyContainers(doc) {
  for (const el of doc.querySelectorAll('div, span, section, ul, ol, dl')) {
    if (!el.textContent.trim()) el.remove();
  }
}

// ─── Link Extraction (before strip, for future crawling) ────────

function extractPageLinks(doc, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:')) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      links.push({
        url: absolute,
        text: (a.textContent || '').trim().slice(0, 200),
      });
    } catch { /* invalid URL */ }
  }
  return links;
}

// ─── Content Density Pruning (fit_markdown) ─────────────────────

function nodeDepth(node) {
  let d = 0, n = node;
  while (n.parentElement) { d++; n = n.parentElement; }
  return d;
}

function pruneByContentDensity(doc) {
  const candidates = doc.querySelectorAll('div, section, aside, ul, ol, table, dl, details');
  const removals = [];

  for (const node of candidates) {
    if (node.parentElement === doc.body) continue;

    const text = (node.textContent || '').trim();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    if (wordCount < 3) { removals.push(node); continue; }

    const htmlLen = node.innerHTML.length;
    const textLen = text.length;
    if (!htmlLen) continue;

    const textDensity = textLen / htmlLen;

    const linkTextLen = Array.from(node.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.textContent || '').trim().length, 0);
    const linkDensity = textLen > 0 ? linkTextLen / textLen : 0;

    if (linkDensity > 0.7 && textDensity < 0.25) {
      removals.push(node);
    }
  }

  removals
    .sort((a, b) => nodeDepth(b) - nodeDepth(a))
    .forEach(n => { if (n.parentElement) n.remove(); });
}

// ─── Markdown Deduplication & Noise Removal ─────────────────────

function deduplicateMarkdownBlocks(md) {
  const blocks = md.split(/\n{2,}/);
  const counts = new Map();

  for (const block of blocks) {
    const key = block.trim().toLowerCase();
    if (key.length < 10) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const seen = new Map();
  return blocks.filter(block => {
    const key = block.trim().toLowerCase();
    const count = counts.get(key) || 0;
    if (count <= 3) return true;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return n === 0;
  }).join('\n\n');
}

const NOISE_LINES_RE = /^(add to cart|agregar al carrito|comprar ahora|buy now|free shipping|envío gratis|envío gratuito|ver más|see more|show more|★[★☆]{0,4})$/i;

function stripNoiseLines(md) {
  return md.split('\n').filter(line => !NOISE_LINES_RE.test(line.trim())).join('\n');
}

const MAX_HTML_SIZE = 5_000_000;

export function htmlToMarkdown(html, url) {
  const safeHtml = html.length > MAX_HTML_SIZE ? html.slice(0, MAX_HTML_SIZE) : html;
  const structuredData = extractStructuredData(safeHtml);

  try {
    const dom = new JSDOM(safeHtml, { url: url || undefined });
    const doc = dom.window.document;

    // Extract all links BEFORE stripping (for future crawling)
    const links = extractPageLinks(doc, url);

    stripUnwantedElements(doc);
    removeEmptyContainers(doc);

    const rawMarkdown = nhm.translate(doc.body?.innerHTML || safeHtml);
    const docTitle = doc.title || '';

    // Generate fitMarkdown BEFORE Readability (which destroys the DOM)
    const fitClone = doc.cloneNode(true);
    pruneByContentDensity(fitClone);
    let fitMarkdown = nhm.translate(fitClone.body?.innerHTML || '');
    fitMarkdown = cleanMarkdownUrls(fitMarkdown);
    fitMarkdown = deduplicateMarkdownBlocks(fitMarkdown);
    fitMarkdown = stripNoiseLines(fitMarkdown);

    // Readability runs on doc directly (no clone needed — we already extracted what we need)
    const reader = new Readability(doc);
    const article = reader.parse();

    let markdown = rawMarkdown;
    let usedReadability = false;

    if (article?.content) {
      const articleMarkdown = nhm.translate(article.content);
      if (articleMarkdown.length > rawMarkdown.length * 0.4) {
        markdown = articleMarkdown;
        usedReadability = true;
      }
    }

    markdown = cleanMarkdownUrls(markdown);

    return {
      markdown,
      fitMarkdown,
      structuredData,
      links,
      title: article?.title || docTitle,
      excerpt: article?.excerpt || '',
      length: markdown.length,
      fitLength: fitMarkdown.length,
      usedReadability,
    };
  } catch {
    const fallback = nhm.translate(safeHtml);
    return {
      markdown: fallback,
      fitMarkdown: fallback,
      structuredData,
      links: [],
      title: '',
      excerpt: '',
      length: fallback.length,
      fitLength: fallback.length,
      usedReadability: false,
    };
  }
}
