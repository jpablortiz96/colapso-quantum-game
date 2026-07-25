# AWS Amplify static deployment

This directory packages, deploys, and verifies the COLAPSO Vite SPA as a manual AWS Amplify Hosting application. It contains no CloudFormation/SAM stack, backend environment, repository connection, build webhook, or runtime credential.

The current live application is:

<https://production.d333fud52cy2ho.amplifyapp.com>

> Running `deploy-amplify.ps1` can create or update AWS resources and submit a billable deployment job. Read the script, confirm the AWS identity and region, and obtain authorization before using it. Documentation and verification commands do not require a redeploy.

## Files

| File | Purpose |
| --- | --- |
| `package-amplify.ps1` | Stages `frontend/dist`, rejects forbidden content, writes a reproducible-layout ZIP and SHA-256 metadata |
| `deploy-amplify.ps1` | Performs AWS preflight, safely creates/reuses the manual app and branch, uploads a release, and records redacted local state |
| `verify-deployment.ps1` | Runs read-only HTTPS, metadata, route, asset, header, cache, budget, and product smoke checks |
| `spa-rule.json` | SPA fallback rewrite rule |
| `custom-headers.yml` | Security and caching headers |
| `deployment.example.json` | Non-secret shape of local deployment state |

Generated `.deployment-state.json`, `.staging/`, `releases/`, and ZIP files are ignored by Git.

## Prerequisites

- Windows PowerShell 5.1 or PowerShell 7
- Node.js 22+ and npm 10+
- AWS CLI v2 for deployment operations
- An explicitly configured AWS profile and region
- Permission for Amplify app, branch, job, and deployment APIs

The script defaults are:

- profile: `colapso`
- region: `us-east-1`
- app name: `colapso-quantum-game`
- branch: `production`

Override them with parameters rather than editing tracked files.

## Verify tooling without AWS

From the repository root:

```powershell
npm ci
npm run verify:production
npm run verify:amplify-package
```

The package verifier and its tests do not call AWS.

## Build and package only

Set the canonical production URL before building:

```powershell
$env:VITE_PUBLIC_SITE_URL = "https://production.d333fud52cy2ho.amplifyapp.com"
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/aws-amplify/package-amplify.ps1 `
  -PublicSiteUrl $env:VITE_PUBLIC_SITE_URL
```

Packaging requires `frontend/dist/index.html`. It rejects:

- a nested `dist/` wrapper;
- source maps;
- source, test, or `node_modules` directories;
- localhost/loopback references;
- canonical or Open Graph URL mismatches;
- unsafe ZIP entry separators.

The release ZIP contains the *contents* of `frontend/dist` at its root.

## Deploy

Before continuing, verify the active identity without sharing its output publicly:

```powershell
aws sts get-caller-identity --profile colapso --region us-east-1
```

Then run the authorized deployment:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/aws-amplify/deploy-amplify.ps1 `
  -AwsProfile "colapso" `
  -AwsRegion "us-east-1" `
  -AppName "colapso-quantum-game" `
  -BranchName "production" `
  -PublicSiteUrl "https://production.d333fud52cy2ho.amplifyapp.com"
```

When `-ReleaseZip` is omitted, the script verifies production prerequisites, builds with the supplied public URL, packages the output, creates a manual deployment, uploads the ZIP, starts the job, waits for completion, and stores only the local state needed for later verification.

A supplied `-ReleaseZip` must already satisfy the same package contract.

## Safety checks

The deploy script fails closed when:

- AWS CLI v2 is absent;
- the configured profile region does not exactly match the parameter;
- caller identity cannot be validated;
- an existing application has a repository connection, backend, environment variables, or unsafe configuration;
- an existing branch is not a manual branch or contains unsafe variables/backend state;
- packaging or production verification fails;
- the upload or Amplify job fails.

Failure output masks account-shaped identifiers, access-key-shaped values, and URLs. This is a defense in depth measure, not permission to paste command output into public reports.

## Read-only production verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/aws-amplify/verify-deployment.ps1 `
  -Url "https://production.d333fud52cy2ho.amplifyapp.com"
```

The verifier checks HTTPS availability, canonical/social metadata, required static assets, JavaScript/CSS chunks, SPA routes, genuine static 404 behavior, headers, cache policy, build budgets, absence of localhost/source maps, and product/audio smoke markers. It does not modify AWS.

## Hosting policy

- Production is a static manually deployed branch.
- CI never deploys and receives no AWS credential.
- No Amplify backend is attached.
- No environment variable is required at runtime.
- The canonical URL is embedded at build time.
- Fingerprinted assets are immutable; HTML and universe data revalidate.
- Deployment state and release archives remain local operational artifacts.

See [`docs/PRODUCTION_READINESS.md`](../../docs/PRODUCTION_READINESS.md) for the full production contract.
