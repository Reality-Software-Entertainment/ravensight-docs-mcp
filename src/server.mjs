import { McpServer, createMcpHandler, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createCatalogStore, CatalogUnavailable, DOCS_URL } from './catalog.mjs';
import { search, getDoc } from './retrieval.mjs';
export const VERSION = '0.1.0';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const uriFor = id => 'ravensight-docs://doc/' + encodeURIComponent(id);
export function createService({ store = createCatalogStore() } = {}) {
  const mcp = createMcpHandler(() => {
    const server = new McpServer({ name: 'ravensight-docs', version: VERSION }, { instructions: 'Search public Ravensight product documentation, then fetch the relevant records. Cite their source URLs. Docs reads are free and need no token. This server does not access game data or modify code. Check stale/revision fields and follow next_offset for complete long records.' });
    server.registerTool('search_docs', {
      description: 'Search current public Ravensight documentation: SDK integration, events, settings, HTTP API, tracking audits, pricing, and troubleshooting. Returns source links and document IDs for get_doc. Free; no account or token.',
      annotations,
      inputSchema: z.object({ query: z.string().trim().min(2).max(300), limit: z.number().int().min(1).max(10).default(5), section: z.string().regex(/^[a-z0-9-]+$/).max(100).optional() }).strict()
    }, async ({ query, limit, section }) => {
      const { catalog, freshness } = await store.get();
      if (section && !catalog.documents.some(d => d.section === section)) return { isError: true, content: [{ type: 'text', text: 'Unknown section. Read ravensight-docs://index for available sections.' }] };
      return text({ ...freshness, query, results: search(catalog, query, limit, section) });
    });
    server.registerTool('get_doc', {
      description: 'Read a public documentation record by ID from search_docs or the docs index. Preserves Markdown/code, source URL and revision. Follow next_offset with the returned revision to read all pages. Free; no account or token.',
      annotations,
      inputSchema: z.object({ id: z.string().regex(/^[a-z0-9/-]+$/).max(200), offset: z.number().int().min(0).max(150000).default(0), max_chars: z.number().int().min(1000).max(20000).default(12000), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
    }, async args => { const { catalog, freshness } = await store.get(); return text({ ...freshness, document: getDoc(catalog, args) }); });
    server.registerResource('docs-index', 'ravensight-docs://index', { title: 'Ravensight documentation index', mimeType: 'application/json', description: 'All document IDs, titles, source links and revisions. Use get_doc for paginated content.' }, async uri => {
      const { catalog, freshness } = await store.get();
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ...freshness, documents: catalog.documents.map(({ content, ...d }) => ({ ...d, uri: uriFor(d.id) })) }) }] };
    });
    server.registerResource('docs-section', new ResourceTemplate('ravensight-docs://doc/{id}', {
      list: async () => { const { catalog } = await store.get(); return { resources: catalog.documents.map(d => ({ uri: uriFor(d.id), name: d.id, title: d.title, description: d.section_title, mimeType: 'application/json' })) }; }
    }), { title: 'Ravensight documentation record', mimeType: 'application/json' }, async (uri, { id }) => {
      const { catalog, freshness } = await store.get();
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ...freshness, document: getDoc(catalog, { id: decodeURIComponent(id) }) }) }] };
    });
    return server;
  }, { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: 16384 });
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS', 'access-control-allow-headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID', 'access-control-expose-headers': 'MCP-Protocol-Version, Retry-After', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  async function handle(request) {
    const url = new URL(request.url);
    // This is intentionally a credential-free, public, read-only endpoint.
    // Any HTTPS browser origin can read it; opaque/file origins are rejected.
    const origin = request.headers.get('origin');
    if (origin) { try { if (!['https:', 'http:'].includes(new URL(origin).protocol)) throw new Error(); } catch { return Response.json({ error: 'Invalid Origin' }, { status: 403, headers }); } }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/health' && request.method === 'GET') {
      try { const { catalog, freshness } = await store.get(); return Response.json({ status: freshness.stale ? 'degraded' : 'ok', version: VERSION, documents: catalog.documents.length, ...freshness }, { status: freshness.stale ? 503 : 200, headers }); }
      catch { return Response.json({ status: 'unavailable', docs_url: DOCS_URL }, { status: 503, headers }); }
    }
    if (url.pathname !== '/mcp') return Response.json({ error: 'Not found', endpoint: '/mcp', docs_url: DOCS_URL }, { status: 404, headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST, OPTIONS' } });
    try {
      // Subscriptions cannot be served by this bounded, stateless Lambda.
      // Bound bytes before parsing/inspecting so malformed oversized input is cheap.
      if (Number(request.headers.get('content-length')) > 16384) return new Response(null, { status: 413, headers });
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 16384) return new Response(null, { status: 413, headers });
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* SDK formats protocol errors. */ }
      if (body?.method === 'subscriptions/listen') return Response.json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'Subscriptions are not supported; read documentation again to refresh.' } }, { status: 200, headers });
      const forwarded = new Request(request.url, { method: 'POST', headers: request.headers, body: bytes });
      const response = await mcp.fetch(forwarded);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    } catch (error) {
      return Response.json({ error: error instanceof CatalogUnavailable ? error.message : 'Documentation service unavailable', docs_url: DOCS_URL }, { status: 503, headers });
    }
  }
  return { handle, close: () => mcp.close() };
}
