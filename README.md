# Ravensight documentation MCP

Public, read-only access to the [Ravensight docs](https://www.ravensight.io/docs/).

**Endpoint:** `https://docs-mcp.ravensight.io/mcp` (remote HTTP, no authentication).
Documentation reads are free. This service cannot access customer studios or player
data, modify projects, or spend Ravensight units. The authenticated analytics MCP
is separate and remains metered. Your agent provider may charge for its work.

## Connect

Codex CLI:

```sh
codex mcp add ravensight-docs --url https://docs-mcp.ravensight.io/mcp
```

Claude Code:

```sh
claude mcp add --transport http ravensight-docs https://docs-mcp.ravensight.io/mcp
```

VS Code / Copilot: merge into `.vscode/mcp.json`, keeping your other servers:

```json
{
  "servers": {
    "ravensight-docs": {
      "type": "http",
      "url": "https://docs-mcp.ravensight.io/mcp"
    }
  }
}
```

Other MCP clients: add the same remote HTTP URL, with authentication disabled.
ChatGPT requires a client/account/workspace that supports custom MCP connections.
Connecting public docs never grants access to your repository.

Configuration references checked October 6, 2026:
[Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Claude Code](https://code.claude.com/docs/en/mcp),
[VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Ask: “Use ravensight-docs to find the Godot setup and event payload limits. Read the
relevant sections, cite them, and compare with the SDK installed in this project.”

## Tools and resources

- `search_docs(query, limit?, section?)`: 2–300 character query, at most 10 hits,
  optional exact section filter. Returns excerpts, IDs, source links, and revisions.
- `get_doc(id, offset?, max_chars?, revision?)`: Markdown with code and tables,
  default 12,000 characters, maximum 20,000. Follow `next_offset` with the returned
  document revision. A changed revision is an error so pages cannot silently mix.
- `ravensight-docs://index`: catalog of available IDs and section names.
- Individual resources listed by the server: bounded document content in JSON,
  with the same continuation metadata as `get_doc`.

Source links point to a section or heading of the published website. Search is
lexical retrieval with bounded terminology aliases, not generated answers. Check
the customer's installed SDK before using methods described in current docs.

The [instrumentation skill](https://github.com/Reality-Software-Entertainment/ravensight-skills)
adds an audit/implementation workflow. Neither the skill nor the docs server
requires the other. No analytics credentials are used by this service.

## Freshness and failure behavior

The website build generates [catalog.json](https://www.ravensight.io/docs/catalog.json)
from its public documentation HTML. This service fetches only that fixed URL,
validates document and catalog hashes, and caches it for five minutes per instance.
Responses include `catalog_revision`, `checked_at`, and `stale`. Content revisions
are hashes, not claims about SDK release versions or timestamps.

On refresh failure, a warm instance can serve known-good content for at most one
hour since its last successful check, explicitly marked stale. Cold starts and
expired caches report unavailable with the website fallback. Failed refreshes back
off for 30 seconds and concurrent refreshes coalesce. `/health` returns 503 for
stale/unavailable content and 200 only for fresh validated content.

Requests are capped at 16 KiB. Catalog fetches are capped at 2 MiB and five seconds.
Production API capacity is shared: 10 requests/second, burst 20, and five concurrent
Lambda executions. AWS throttles are best-effort service limits, not a strict billing
cap. On 429, retry with exponential backoff and jitter. GET `/mcp` returns 405 by
design; use an MCP client, not a browser page fetch. No subscriptions are offered.

Public HTTP(S) browser origins can read documentation without credentials; opaque
origins are rejected. No request body or query is written to an application database.
Hosting operational metadata may be logged. Send documentation questions only,
never secrets, player data, or private source code.

## Develop

Node 24+:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm start
# another terminal
node scripts/smoke.mjs http://127.0.0.1:8787/mcp
```

Tests cover the official MCP client in legacy and modern protocol modes, tools and
resources, retrieval questions, revision-aware pagination, malformed inputs,
cache refresh, and outages. `test/fixtures/catalog.json` is a snapshot of public
documentation for deterministic regression tests; production never serves it.
Refresh it from the published catalog after documentation changes when needed.
An SDK-level integration test does not prove every agent client's UI behavior.

## Deploy and operate

See [deploy/README.md](deploy/README.md). The standalone infrastructure has no
analytics/database permissions. Updating website docs updates the catalog; no MCP
server redeploy is needed for documentation-only changes. No npm publication is
required. Licensed under MIT.
