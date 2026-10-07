import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createCatalogStore, validateCatalog, CATALOG_URL } from '../src/catalog.mjs';
import { search, getDoc } from '../src/retrieval.mjs';
import { createService } from '../src/server.mjs';
import { listen } from '../src/local.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url)));
const response = value => Response.json(value);
const store = () => createCatalogStore({ fetcher: async url => { assert.equal(url, CATALOG_URL); return response(fixture); } });

test('validates the real public catalog and refuses corrupted content', () => {
  assert.equal(validateCatalog(fixture).documents.length > 100, true);
  const bad = structuredClone(fixture); bad.documents[0].content += 'wrong';
  assert.throws(() => validateCatalog(bad));
});

test('representative integration questions find the relevant public docs', () => {
  const cases = [
    ['Godot SDK setup', 'godot-sdk'], ['HTTP API event ingestion', 'http-api'],
    ['audit expand existing tracking', 'instrumentation-skill'], ['level location track', 'run-sql'],
    ['MCP pricing limits', 'limits'], ['Godot retry flush', 'godot-sdk']
  ];
  for (const [q, section] of cases) assert.ok(search(fixture, q, 5).some(d => d.section === section), q + ': ' + JSON.stringify(search(fixture,q,5).map(d=>d.id)));
  assert.deepEqual(search(fixture, 'zzzznotawordzzzz'), []);
  assert.ok(search(fixture, 'settings', 2, 'godot-sdk').every(d => d.section === 'godot-sdk'));
});

test('pagination reconstructs a record exactly and refuses obsolete revisions', () => {
  const doc = [...fixture.documents].sort((a,b)=>b.content.length-a.content.length)[0];
  let offset = 0, content = '';
  do { const page = getDoc(fixture, { id: doc.id, offset, max_chars: 1000, revision: doc.revision }); content += page.content; offset = page.next_offset; } while (offset !== null);
  assert.equal(content, doc.content);
  assert.throws(() => getDoc(fixture, { id: doc.id, revision: '0'.repeat(64) }), /changed/);
  assert.throws(() => getDoc(fixture, { id: doc.id, offset: doc.content.length+1 }), /outside/);
  assert.throws(() => getDoc(fixture, { id: '../../secret' }), /Unknown/);
  assert.throws(() => getDoc(fixture, { id: doc.id, offset: 1 }), /Supply the returned/);
});

test('cache coalesces refreshes, marks stale results, and expires safely during outages', async () => {
  let time = 100000, calls = 0, fail = false;
  const cache = createCatalogStore({ now: () => time, ttl: 100, maxAge: 1000, retryDelay: 50, fetcher: async () => { calls++; if (fail) throw Error('offline'); return response(fixture); } });
  await Promise.all([cache.get(),cache.get(),cache.get()]); assert.equal(calls, 1);
  fail = true; time += 101;
  assert.equal((await cache.get()).freshness.stale, true); assert.equal(calls,2);
  await cache.get(); assert.equal(calls,2);
  time += 1001; await assert.rejects(cache.get(), /temporarily unavailable/);
  fail = false; time += 51; assert.equal((await cache.get()).freshness.stale, false);
});

test('cold outages and oversized catalogs fail with the website fallback', async () => {
  for (const fetcher of [async()=>{throw Error();},async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}}),async()=>Response.json({})]) {
    await assert.rejects(createCatalogStore({fetcher}).get(), /https:\/\/www.ravensight.io\/docs\//);
  }
});

for (const mode of ['legacy', 'auto']) test('official MCP HTTP client: ' + mode, async () => {
  const service = createService({store: store()});
  const http = listen(service, 0); await once(http, 'listening');
  const client = new Client({name:'docs-integration-test',version:'1.0.0'}, {versionNegotiation:{mode}});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`)));
    if (mode === 'auto') assert.equal(client.getProtocolEra(), 'modern');
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(t=>t.name).sort(),['get_doc','search_docs']);
    assert.ok(listed.tools.every(t=>t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    const found = await client.callTool({name:'search_docs',arguments:{query:'Godot SDK setup'}});
    assert.ok(!found.isError, JSON.stringify(found));
    const parsed = JSON.parse(found.content[0].text); assert.ok(parsed.results.length);
    const read = await client.callTool({name:'get_doc',arguments:{id:parsed.results[0].id}});
    assert.ok(JSON.parse(read.content[0].text).document.content.length);
    const bad = await client.callTool({name:'get_doc',arguments:{id:'does-not-exist'}}); assert.equal(bad.isError,true);
    const bounds = await client.callTool({name:'search_docs',arguments:{query:'a'.repeat(301)}}); assert.equal(bounds.isError,true);
    const resources = await client.listResources(); assert.ok(resources.resources.length > 100);
    const index = await client.readResource({uri:'ravensight-docs://index'}); assert.equal(JSON.parse(index.contents[0].text).catalog_revision,fixture.revision);
    const section = resources.resources.find(r=>r.uri.includes('%2F'));
    const resource = await client.readResource({uri:section.uri}); assert.ok(JSON.parse(resource.contents[0].text).document.content);
  } finally { await client.close(); await service.close(); http.closeAllConnections(); await new Promise(r=>http.close(r)); }
});

test('HTTP limits, invalid origins, health, and unsupported methods are explicit', async () => {
  const service = createService({store:store()});
  const req = (path, init) => service.handle(new Request('https://docs-mcp.ravensight.io'+path, init));
  assert.equal((await req('/health')).status,200);
  assert.equal((await req('/missing')).status,404);
  assert.equal((await req('/mcp')).status,405);
  assert.equal((await req('/mcp',{method:'OPTIONS',headers:{origin:'https://example.com'}})).headers.get('access-control-allow-origin'),'*');
  assert.equal((await req('/mcp',{method:'POST',headers:{origin:'null'},body:'{}'})).status,403);
  assert.equal((await req('/mcp',{method:'POST',body:'x'.repeat(17000)})).status,413);
  const offline=createService({store:createCatalogStore({fetcher:async()=>{throw Error();}})});
  assert.equal((await offline.handle(new Request('https://docs-mcp.ravensight.io/health'))).status,503);
  await service.close(); await offline.close();
});
