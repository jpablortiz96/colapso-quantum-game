# AWS Amplify static deployment

This directory packages, deploys, and verifies the COLAPSO Vite SPA as a manual AWS Amplify Hosting application. It contains no CloudFormation/SAM stack, backend environment, repository connection, build webhook, or runtime credential.

The current live application is:

<https://production.d333fud52cy2ho.amplifyapp.com>

> Running `deploy-amplify.ps1` updates the named existing Amplify application and can submit a billable deployment job. It never creates an application and fails closed if that app is absent. Read the script, confirm the AWS identity and region, and obtain authorization before using it. Documentation and verification commands do not require a redeploy.

## Files

| File | Purpose |
| --- | --- |
| `package-amplify.ps1` | Stages `frontend/dist`, rejects forbidden content, writes a reproducible-layout ZIP and SHA-256 metadata |
| `deploy-amplify.ps1` | Performs AWS preflight, requires/reuses the named manual app, creates or reuses its branch, uploads a release, and records redacted local state |
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

## Finalize and verify without IBM or AWS

From the repository root, the complete five-universe release candidate is finalized and checked with one command:

```powershell
npm ci
npm run release:finalize-offline
```

The command strictly verifies preserved evidence, writes canonical finalized campaign artifacts, runs backend/frontend/repository gates, builds the SPA, and exercises local package verification. It performs no IBM access, job submission, AWS call, deployment, commit, or push. To repeat only validation after finalization, use `npm run release:prepare-offline`.

`verify:amplify-package` creates ignored diagnostic ZIP/metadata under `deployment/aws-amplify/releases/`; successful package verification is not a deployment.

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

A new release must start from a clean committed working tree; the deploy script checks this before making any AWS call. The named Amplify application must already exist with the required ownership and safety configuration; the script will not create a replacement. Review the exact commit and rerun `npm run release:prepare-offline` before authorizing deployment. A supplied historical rollback ZIP follows its own checksum path.

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

- the named existing Amplify application is absent or not unique;
- a new release is attempted from a dirty or uncommitted Git working tree;
- AWS CLI v2 is absent;
- the configured profile region does not exactly match the parameter;
- caller identity cannot be validated;
- an existing application has a repository connection, backend, environment variables, or unsafe configuration;
- an existing branch is not a manual branch or contains unsafe variables/backend state;
- packaging or production verification fails;
- the upload or Amplify job fails.

Failure output masks account-shaped identifiers, access-key-shaped values, and URLs. This is a defense in depth measure, not permission to paste command output into public reports.

## Release screenshots

The capture workflow defaults to `http://127.0.0.1:4173` and refuses remote targets unless explicitly authorized. After starting a local Vite preview manually, run:

```powershell
npm run capture:screenshots
```

It prepares the #001 hero/provenance/gameplay/Guided Journey views plus the five-entry campaign selector, Universe #005, #005 shared-CHSH provenance, and mobile view. After an authorized deployment, remote capture requires both the URL and an explicit opt-in:

```powershell
npm run capture:screenshots -- "https://production.d333fud52cy2ho.amplifyapp.com" --allow-remote
```

Remote capture was not run during offline preparation.

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
