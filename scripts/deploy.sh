#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${HOSTED_ZONE_ID:?Set the Route53 hosted zone ID for the docs MCP domain}"
DEPLOY_REGION="${DEPLOY_REGION:-us-east-1}"
DOCS_DOMAIN="${DOCS_DOMAIN:-docs-mcp.ravensight.io}"
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit the reviewed source before deploying.' >&2; exit 1; }
npm ci --ignore-scripts
npm test
npm run build
(cd dist && zip -q -j lambda.zip index.mjs)
RELEASE_DIGEST="$(shasum -a 256 dist/lambda.zip | cut -d ' ' -f 1)"
aws cloudformation deploy --region "$DEPLOY_REGION" --stack-name ravensight-docs-mcp-artifacts --template-file deploy/artifacts.yaml --no-fail-on-empty-changeset
ARTIFACT_BUCKET="$(aws cloudformation describe-stacks --region "$DEPLOY_REGION" --stack-name ravensight-docs-mcp-artifacts --query 'Stacks[0].Outputs[?OutputKey==`Bucket`].OutputValue' --output text)"
ARTIFACT_KEY="releases/$RELEASE_DIGEST/lambda.zip"
aws s3 cp dist/lambda.zip "s3://$ARTIFACT_BUCKET/$ARTIFACT_KEY" --region "$DEPLOY_REGION" --only-show-errors
aws cloudformation deploy --region "$DEPLOY_REGION" --stack-name ravensight-docs-mcp --template-file deploy/service.yaml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides "ArtifactBucket=$ARTIFACT_BUCKET" "ArtifactKey=$ARTIFACT_KEY" "HostedZoneId=$HOSTED_ZONE_ID" "Domain=$DOCS_DOMAIN"
aws cloudformation describe-stacks --region "$DEPLOY_REGION" --stack-name ravensight-docs-mcp --query 'Stacks[0].Outputs' --output json
printf 'Source revision: '
git rev-parse HEAD
printf 'Artifact SHA256: %s\n' "$RELEASE_DIGEST"
