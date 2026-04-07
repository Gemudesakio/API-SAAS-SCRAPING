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

export function getPlaywrightProxyConfig() {
  const raw = (process.env.PROXY_URL || '').trim();
  if (!raw) return null;

  const parsed = new URL(raw);
  const proxy = { server: `${parsed.protocol}//${parsed.host}` };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  return proxy;
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

  if ([401, 403, 429, 503].includes(Number(status))) return true;

  const haystack = `${pageUrl} ${pageTitle} ${pageText}`.toLowerCase();
  const haystackAscii = haystack
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const challengeSignals = [
    '/gz/account-verification',
    'account-verification',
    'captcha',
    'cloudflare',
    'challenge',
    'security check',
    'verificacion de seguridad',
    'are you human',
    'verify you are human',
    'recaptcha',
    'hcaptcha',
    'access denied',
    'actividad inusual',
    'actividad sospechosa',
    'verifica tu identidad',
    'verifica que no eres un robot',
    'verifica que eres humano',
    'enable javascript and cookies to continue',
    'unusual traffic',
    'slide to verify',
    'please verify',
    'bot detection',
    'automated access',
    'trafico inusual',
    'not a robot',
    'press & hold',
    'just a moment',
  ];

  return challengeSignals.some(
    (signal) => haystack.includes(signal) || haystackAscii.includes(signal)
  );
}
