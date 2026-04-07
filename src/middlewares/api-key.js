export default function apiKeyAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();

  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (provided === apiKey) return next();

  return res.status(401).json({
    ok: false,
    error: 'Invalid or missing API key',
    code: 'UNAUTHORIZED',
  });
}
