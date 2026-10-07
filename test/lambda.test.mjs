import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url)));
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{assert.equal(url,'https://www.ravensight.io/docs/catalog.json');return Response.json(fixture);};
const source=await import('../src/lambda.mjs');
const bundle=await import('../dist/index.mjs');
globalThis.fetch=originalFetch;
for(const [name,{handler}] of [['source',source],['bundle',bundle]]) test('Lambda '+name+' preserves MCP results, base64 input, and HTTP limits',async()=>{
 const event=message=>({rawPath:'/mcp',requestContext:{http:{method:'POST'}},headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},isBase64Encoded:true,body:Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,...message})).toString('base64')});
 const result=await handler(event({method:'tools/call',params:{name:'search_docs',arguments:{query:'Godot SDK setup'}}}));
 assert.equal(result.statusCode,200,result.body);assert.ok(result.body.includes('catalog_revision'),result.body);assert.ok(result.body.includes('godot-sdk'),result.body);
 const tooLarge=event({method:'ping'});tooLarge.body=Buffer.alloc(17000).toString('base64');assert.equal((await handler(tooLarge)).statusCode,413);
 const health=await handler({rawPath:'/health',requestContext:{http:{method:'GET'}},headers:{}});assert.equal(health.statusCode,200);assert.equal(JSON.parse(health.body).catalog_revision,fixture.revision);
});
