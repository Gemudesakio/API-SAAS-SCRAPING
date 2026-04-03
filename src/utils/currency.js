const EXCHANGE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedRates = null;
let cachedAt = 0;
let fetchPromise = null;

export async function getExchangeRates() {
  if (cachedRates && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedRates;
  }

  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const response = await fetch(EXCHANGE_API_URL);

      if (!response.ok) {
        if (cachedRates) return cachedRates;
        throw new Error(`Exchange rate API error: ${response.status}`);
      }

      const data = await response.json();
      cachedRates = data.rates;
      cachedAt = Date.now();
      return cachedRates;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export async function convertToCOP(amount, fromCurrency = 'USD') {
  if (!amount || fromCurrency === 'COP') return amount;

  const rates = await getExchangeRates();
  const copRate = rates.COP;
  const fromRate = rates[fromCurrency] || 1;

  return Math.round(amount * (copRate / fromRate));
}
