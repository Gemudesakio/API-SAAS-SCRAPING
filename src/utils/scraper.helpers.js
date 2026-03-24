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

export function detectChallenge(pageText = '') {
  const text = pageText.toLowerCase();
  const challengeSignals = [
    'captcha',
    'cloudflare',
    'are you human',
    'verifica que eres humano',
    'access denied',
  ];

  return challengeSignals.some((signal) => text.includes(signal));
}
