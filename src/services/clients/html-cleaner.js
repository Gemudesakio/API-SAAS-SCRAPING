import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhm = new NodeHtmlMarkdown({
  maxConsecutiveNewlines: 2,
  bulletMarker: '-',
});

const STRIP_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg'];

const STRIP_SELECTORS = [
  'nav', 'footer', 'header', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[role="search"]',
  '.cookie-banner', '.cookie-consent', '#cookie-consent',
  '.ad', '.ads', '.advertisement', '[data-ad]',
  '.social-share', '.share-buttons',
  // Search page noise: filters, breadcrumbs, pagination
  '.breadcrumb', '[aria-label="breadcrumb"]', 'ol.breadcrumb',
  '.sidebar', '.filters', '.facets', '.refinements',
  '.pagination', '.pager', '[aria-label="pagination"]',
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

export function htmlToMarkdown(html, url) {
  try {
    const dom = new JSDOM(html, { url: url || undefined });
    const doc = dom.window.document;

    stripUnwantedElements(doc);

    const rawMarkdown = nhm.translate(doc.body?.innerHTML || html);

    const reader = new Readability(doc.cloneNode(true));
    const article = reader.parse();

    let markdown = rawMarkdown;
    let usedReadability = false;

    if (article?.content) {
      const articleMarkdown = nhm.translate(article.content);
      // Use Readability only if it preserved enough content (>40% of raw).
      // For product listings / search results, Readability strips too much.
      if (articleMarkdown.length > rawMarkdown.length * 0.4) {
        markdown = articleMarkdown;
        usedReadability = true;
      }
    }

    markdown = cleanMarkdownUrls(markdown);

    return {
      markdown,
      title: article?.title || doc.title || '',
      excerpt: article?.excerpt || '',
      length: markdown.length,
      usedReadability,
    };
  } catch {
    // Fallback: if JSDOM/Readability fails on malformed HTML, convert raw
    const fallback = nhm.translate(html);
    return {
      markdown: fallback,
      title: '',
      excerpt: '',
      length: fallback.length,
      usedReadability: false,
    };
  }
}
