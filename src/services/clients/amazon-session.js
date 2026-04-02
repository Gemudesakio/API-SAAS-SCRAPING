import { buildUserAgent } from '../../utils/scraper.helpers.js';

const AMAZON_BASE = 'https://www.amazon.com';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

let cachedCookieString = '';
let cachedAt = 0;
let initPromise = null;

const COMMON_HEADERS = {
  'User-Agent': buildUserAgent(),
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
};

function extractCookies(response, existing = new Map()) {
  const cookies = new Map(existing);
  const setCookieHeaders = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];

  for (const header of setCookieHeaders) {
    const [nameValue] = header.split(';');
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) {
      cookies.set(
        nameValue.substring(0, eqIdx).trim(),
        nameValue.substring(eqIdx + 1).trim()
      );
    }
  }
  return cookies;
}

function cookieString(cookies) {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function initColombiaSession() {
  // Step 1: GET amazon.com to obtain session cookies
  const initRes = await fetch(AMAZON_BASE, {
    headers: COMMON_HEADERS,
    redirect: 'follow',
  });
  await initRes.text(); // consume body
  let cookies = extractCookies(initRes);

  // Step 2: GET address-selections to obtain CSRF token
  const selectionsUrl = `${AMAZON_BASE}/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Gateway&storeContext=NoStoreName&actionSource=desktop-modal`;
  const selectionsRes = await fetch(selectionsUrl, {
    headers: { ...COMMON_HEADERS, Cookie: cookieString(cookies) },
    redirect: 'follow',
  });
  const selectionsHtml = await selectionsRes.text();
  cookies = extractCookies(selectionsRes, cookies);

  const csrfMatch = selectionsHtml.match(/anti-csrftoken-a2z[^"]*"([^"]+)"/);
  const csrfToken = csrfMatch?.[1] || '';

  // Step 3: POST address change to Colombia
  const changeRes = await fetch(
    `${AMAZON_BASE}/portal-migration/hz/glow/address-change?actionSource=glow`,
    {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'anti-csrftoken-a2z': csrfToken,
        'x-amzn-flow-closure-id': String(Math.floor(Date.now() / 1000)),
        Cookie: cookieString(cookies),
      },
      body: JSON.stringify({
        locationType: 'COUNTRY',
        district: 'CO',
        countryCode: 'CO',
        deviceType: 'web',
        storeContext: 'generic',
        pageType: 'Gateway',
        actionSource: 'glow',
      }),
      redirect: 'follow',
    }
  );
  const changeBody = await changeRes.text();
  cookies = extractCookies(changeRes, cookies);

  // Step 4: GET condo-refresh to obtain sp-cdn cookie
  const refreshRes = await fetch(
    `${AMAZON_BASE}/portal-migration/hz/glow/condo-refresh-html?triggerFeature=AddressList&deviceType=desktop&pageType=Gateway&storeContext=NoStoreName&locker=%7B%7D`,
    {
      headers: { ...COMMON_HEADERS, Cookie: cookieString(cookies) },
      redirect: 'follow',
    }
  );
  await refreshRes.text();
  cookies = extractCookies(refreshRes, cookies);

  return cookieString(cookies);
}

export async function getAmazonColombiaCookies() {
  if (cachedCookieString && Date.now() - cachedAt < SESSION_TTL_MS) {
    return cachedCookieString;
  }

  // Deduplicate concurrent init calls
  if (!initPromise) {
    initPromise = initColombiaSession()
      .then((result) => {
        cachedCookieString = result;
        cachedAt = Date.now();
        initPromise = null;
        return result;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }

  try {
    return await initPromise;
  } catch {
    return ''; // Fallback: no cookies, rely on URL param
  }
}
