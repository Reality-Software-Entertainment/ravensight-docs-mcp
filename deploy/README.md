# Deployment and operations

The service uses an isolated AWS stack: Lambda Node 24/ARM64, API Gateway HTTP API,
a regional TLS certificate, and a Route53 alias. It does not deploy or modify the
Ravensight analytics API, dashboard, databases, or billing. The runtime role can
write only its own CloudWatch log streams. No database credentials or API secrets
are configured. The default execute-api URL is disabled; use the custom domain.

## Release

Prerequisites: Node 24+, npm, AWS CLI, zip, shasum, and AWS credentials allowed to
manage the named CloudFormation stacks and associated IAM/Lambda/API Gateway/
ACM/Route53/S3/CloudWatch resources. Default region is us-east-1; pass
`DEPLOY_REGION` and `DOCS_DOMAIN` only when intentionally targeting another setup.

1. Run `npm ci --ignore-scripts`, `npm test`, `npm run build`, and review the exact
   commit's CI. Commit changes. The deployment script refuses a dirty checkout.
2. Ensure the website release has generated and published `/docs/catalog.json`
   from its HTML. Verify the catalog content type and hashes. Publish only public
   product documentation; this service must never point at private documents.
3. From this repository:

   ```sh
   HOSTED_ZONE_ID=your_route53_zone_id bash scripts/deploy.sh
   node scripts/smoke.mjs https://docs-mcp.ravensight.io/mcp
   ```

   The script builds a Lambda bundle, uploads it to a private artifact bucket under
   its SHA-256, and creates/updates `ravensight-docs-mcp`. ACM DNS validation can
   take several minutes. Failed CloudFormation updates roll back by default.
4. Require `/health` HTTP 200 with `status: ok`, a fresh source check, and the
   expected catalog revision. The smoke test checks tools/resources in modern and
   legacy protocol modes. Check website setup instructions and the skill reference.
5. Record server source SHA, artifact hash, catalog revision, CI, stack outputs,
   and health/smoke results in the deployment log. Do not treat a build as a release.

## Limits and observations

- API stage: 10 requests/second, burst 20, shared across callers (best-effort AWS
  throttle). Lambda reserved concurrency 5, 256 MiB memory, 10-second timeout.
- Input bodies: 16 KiB. Catalog: 2 MiB, 500 records, 150,000 characters per record,
  five-second fetch timeout. Only the fixed public catalog URL is fetched; redirects
  are refused. Five-minute cache, one-hour maximum last-known-good age, 30-second
  retry backoff. There is no catalog stored persistently in Lambda.
- `/health` actually validates the catalog; stale content returns 503. Initialization
  and tool discovery alone do not prove that documentation can be retrieved.
- CloudWatch has a server-error alarm and 14-day Lambda logs. The alarm has no
  notification recipient by default; wire the owner's normal alert destination
  separately if desired. API request-body logging is not enabled. No model calls,
  analytics reads, or customer wallet operations occur.
- GET `/mcp` is deliberately 405; requests use POST, and OPTIONS supports browser
  clients. Subscriptions and resumable server-sent streams are not supported.
  Browser origins can access this public, credential-free surface via CORS.
- DNS/TLS, IAM failures, throttling, and source-CDN failures are distinct operational
  failure modes. Check `/health`, stack events, API metrics, and Lambda logs before
  changing application code. Avoid logging request bodies or documentation queries.

## Rollback and refresh

Documentation content updates require only the website/catalog publish and cache
expiry. Restore the previous website + catalog together to roll back a bad content
release; invalidate the website paths. The service refreshes within five minutes.

For server rollback, update the stack's `ArtifactKey` to the previous recorded
artifact while preserving its other parameters and infrastructure template. Do not
rebuild an old revision with new dependencies and call it the same artifact. Keep
previous immutable objects available in the versioned artifact bucket.

Deleting the service stack removes the endpoint, DNS alias and runtime resources.
The artifact bucket is retained deliberately. Never delete shared analytics or
marketing resources to roll back this service.
