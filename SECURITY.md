# Security Policy

## Supported version

Security fixes are applied to the latest code on `main` and the latest published release. Historical development snapshots are not supported.

## Report a vulnerability privately

Use GitHub's **Private vulnerability reporting** for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Provide reproduction steps, affected paths/version, impact, and any safe proof of concept.

Do not open a public issue, discussion, or pull request for an unpatched vulnerability. Do not include real credentials, personal data, provider account details, or destructive payloads.

If private reporting is unavailable, open a public issue containing no sensitive detail and ask the maintainer to enable a private channel.

## What to expect

Maintainers will aim to:

- acknowledge a complete report within 5 business days;
- reproduce and assess scope without exposing the report;
- coordinate remediation and disclosure with the reporter;
- publish a fix and advisory when warranted.

Timelines can vary with complexity and maintainer availability. Please avoid public disclosure until a fix or coordinated disclosure date exists.

## In scope

- client-side injection, unsafe HTML, or CSP bypass in the production application;
- dependency or build-chain vulnerabilities with a credible project impact;
- exposed secrets or sensitive operational data in tracked/public artifacts;
- unsafe repository automation, CI permissions, or release provenance;
- path traversal or unsafe archive behavior in packaging/mirror scripts;
- integrity-verification bypasses for evidence or published universes;
- deterministic replay/serialization flaws that cross a documented security boundary.

## Known boundaries that are not vulnerabilities

- The universe JSON and resolution material are public and inspectable.
- COLAPSO does not claim anti-cheat security or hidden future outcomes.
- The production game is a static client with no account, database, leaderboard, or server-side game state.
- IBM job IDs in the preserved real evidence are intentional provenance references; access may require provider authorization.
- A one-basis correlation is not presented as a Bell violation, and tactical pair mechanics are not physical certification.
- Browser local storage contains non-sensitive preferences only.
- The player interface is Spanish while engineering documentation is English.

A report showing that these disclosed properties exist, without a boundary violation, is out of scope.

## Safe research

- Use your own browser, local clone, cloud account, and provider account.
- Prefer local/simulated tests over live services.
- Do not submit IBM workloads or deploy AWS resources without explicit authorization.
- Do not access another person's data or account.
- Avoid denial of service, social engineering, spam, persistence, or destructive actions.
- Stop and report if you encounter a credential or personal data.

Good-faith research that follows these constraints is welcomed.

## Secrets

Never report a live secret by committing it. Revoke exposed credentials first through the relevant provider, then report the location and redacted identifier privately. The repository's secret scanner is a preventive control, not a substitute for provider-side rotation.
