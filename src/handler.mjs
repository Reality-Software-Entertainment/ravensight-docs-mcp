import { createService } from './server.mjs';
const service = createService();
export async function handler(event) {
  const method = event.requestContext?.http?.method || 'GET';
  const bytes = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : undefined;
  if (bytes?.length > 16384) return { statusCode: 413, headers: { 'cache-control': 'no-store' }, body: 'Request too large' };
  const request = new Request('https://docs-mcp.ravensight.io' + (event.rawPath || '/') + (event.rawQueryString ? '?' + event.rawQueryString : ''), { method, headers: event.headers, body: method === 'POST' ? bytes : undefined });
  const response = await service.handle(request);
  return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), isBase64Encoded: false };
}
