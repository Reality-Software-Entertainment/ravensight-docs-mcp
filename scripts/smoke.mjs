import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const endpoint = new URL(process.argv[2] || 'https://docs-mcp.ravensight.io/mcp');
for (const mode of ['legacy', 'auto']) {
  const client = new Client({name:'ravensight-docs-release-check',version:'1.0.0'}, {versionNegotiation:{mode}});
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    const tools=await client.listTools(); assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get_doc','search_docs']);
    const found=await client.callTool({name:'search_docs',arguments:{query:'Godot SDK setup'}});
    assert.ok(!found.isError,JSON.stringify(found)); const result=JSON.parse(found.content[0].text); assert.ok(result.results.length); assert.equal(result.stale,false);
    const read=await client.callTool({name:'get_doc',arguments:{id:result.results[0].id}}); assert.ok(!read.isError,JSON.stringify(read));
    const resources=await client.listResources(); assert.ok(resources.resources.length>100);
    const index=await client.readResource({uri:'ravensight-docs://index'}); assert.equal(JSON.parse(index.contents[0].text).catalog_revision,result.catalog_revision);
    console.log(JSON.stringify({mode,era:client.getProtocolEra(),tools:tools.tools.length,resources:resources.resources.length,revision:result.catalog_revision}));
  } finally { await client.close(); }
}
const response=await fetch(new URL('/health',endpoint)); assert.equal(response.status,200); console.log(await response.text());
