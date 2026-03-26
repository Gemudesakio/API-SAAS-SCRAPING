export async function textOrEmpty(locator) {
  try {
    if (await locator.count()) {
      const text = await locator.first().innerText();
      return text?.trim() || '';
    }
  } catch {
    // no-op: devuelve cadena vacia
  }

  return '';
}

export async function attrOrEmpty(locator, attrNames = []) {
  try {
    if (await locator.count()) {
      const node = locator.first();

      for (const attr of attrNames) {
        const value = await node.getAttribute(attr);
        if (value?.trim()) return value.trim();
      }
    }
  } catch {
    // no-op: devuelve cadena vacia
  }

  return '';
}

export function absoluteUrl(baseUrl, url = '') {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${baseUrl}${url}`;
  return `${baseUrl}/${url}`;
}

export function cleanPriceToInt(value) {
  if (value === null || value === undefined) return 0;
  const digits = String(value).replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function buildUserAgent() {
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
}

export function detectChallenge(input = '') {
  let pageText = '';
  let pageTitle = '';
  let pageUrl = '';
  let status = null;

  if (typeof input === 'string') {
    pageText = input;
  } else if (input && typeof input === 'object') {
    pageText = input.pageText || '';
    pageTitle = input.title || '';
    pageUrl = input.url || '';
    status = input.status ?? null;
  }

  if ([403, 429, 503].includes(Number(status))) return true;

  const haystack = `${pageUrl} ${pageTitle} ${pageText}`.toLowerCase();
  const challengeSignals = [
    'captcha',
    'cloudflare',
    'challenge',
    'are you human',
    'verify you are human',
    'recaptcha',
    'hcaptcha',
    'access denied',
    'actividad inusual',
    'actividad sospechosa',
    'verifica que no eres un robot',
    'verifica que eres humano',
  ];

  return challengeSignals.some((signal) => haystack.includes(signal));
}
