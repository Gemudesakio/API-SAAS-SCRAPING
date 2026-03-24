import crypto from 'node:crypto';

export function createCompeId(site, url, name) {
  const seed = `${site}|${url || ''}|${name || ''}`;
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8);

  return `cp_${hash}`;
}
