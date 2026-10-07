import { createHash } from 'node:crypto';
export const CATALOG_URL = 'https://www.ravensight.io/docs/catalog.json';
export const DOCS_URL = 'https://www.ravensight.io/docs/';
const MAX_BYTES = 2 * 1024 * 1024;
const sha = s => createHash('sha256').update(s).digest('hex');
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
export function validateCatalog(value) {
  if (value?.schema_version !== 1 || value.source_url !== DOCS_URL || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.documents) || !value.documents.length || value.documents.length > 500) throw new Error('Invalid documentation catalog');
  const ids = new Set();
  for (const d of value.documents) {
    if (!d || typeof d.id !== 'string' || !/^[a-z0-9/-]{1,200}$/.test(d.id) || ids.has(d.id)) throw new Error('Invalid documentation ID');
    ids.add(d.id);
    for (const key of ['section', 'section_title', 'title', 'content', 'url', 'revision']) if (typeof d[key] !== 'string' || !d[key]) throw new Error('Incomplete documentation record');
    if (d.content.length > 150000 || d.title.length > 500 || d.section_title.length > 500 || d.url.length > 500 || !d.url.startsWith(DOCS_URL + '#') || d.revision !== sha(d.content)) throw new Error('Invalid documentation content');
  }
  if (sha(JSON.stringify(stable(value.documents))) !== value.revision) throw new Error('Documentation revision mismatch');
  return value;
}
export class CatalogUnavailable extends Error {
  constructor() { super('Documentation is temporarily unavailable. Read ' + DOCS_URL + ' or retry shortly.'); }
}
export function createCatalogStore({ fetcher = fetch, now = Date.now, ttl = 300000, maxAge = 3600000, retryDelay = 30000 } = {}) {
  let cached, checkedAt = 0, retryAt = 0, pending;
  async function refresh() {
    try {
      const response = await fetcher(CATALOG_URL, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Invalid catalog response');
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error('Catalog too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      cached = validateCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      checkedAt = now(); retryAt = 0;
    } catch {
      retryAt = now() + retryDelay;
      if (!cached || now() - checkedAt > maxAge) throw new CatalogUnavailable();
    }
  }
  return {
    async get() {
      if ((!cached || now() - checkedAt >= ttl) && now() >= retryAt) {
        if (!pending) pending = refresh().finally(() => { pending = undefined; });
        await pending;
      }
      if (!cached || now() - checkedAt > maxAge) throw new CatalogUnavailable();
      return { catalog: cached, freshness: { catalog_revision: cached.revision, checked_at: new Date(checkedAt).toISOString(), stale: now() - checkedAt >= ttl, source_url: DOCS_URL } };
    }
  };
}
