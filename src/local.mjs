import { createServer } from 'node:http';
import { createService } from './server.mjs';
export function listen(service = createService(), port = Number(process.env.PORT || 8787)) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16384) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const request = new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
      const response = await service.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end('Internal error'); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) listen().on('listening', () => console.log('Docs MCP listening on http://127.0.0.1:8787/mcp'));
