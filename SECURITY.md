# Security Policy

## Reporting a vulnerability

Clawthority is a policy engine — safety regressions are the single worst class of bug we can ship. If you've found one, thank you for taking the time to report it responsibly.

**Do not file a public issue.** Instead:

- Email: **security@openauthority.dev** *(TODO: replace with the real address you want to receive reports at)*
- Alternative: use GitHub's [private vulnerability reporting](https://github.com/OpenAuthority/clawthority/security/advisories/new)

Please include:

- A description of the issue and the affected versions.
- A proof-of-concept or minimal reproduction if possible.
- The impact as you understand it (bypass of which rule class, etc.).
- Whether you'd like to be credited in the advisory.

## What to expect

- **Acknowledgement** within 48 hours of your report.
- **Initial assessment** within 5 business days, including a severity rating.
- **Fix timeline**:
  - Critical / High: patch released within 7 days.
  - Medium: patch in the next minor release (typically ≤ 30 days).
  - Low: patch in a scheduled release.
- **Disclosure**: coordinated — we'll agree on a public advisory date with you before publishing. Credit is given unless you prefer to stay anonymous.

## Scope

In scope:

- Bypasses of the capability gate or constraint enforcement engine.
- Rules or policies that can be evaluated incorrectly given adversarial input.
- Audit-log tampering, gaps, or injection.
- HITL approval bypasses (session token replay, TTL handling, channel spoofing).
- Supply-chain concerns in `dependencies`.

Out of scope:

- Misconfiguration of rules by operators (we'll treat these as docs bugs if the docs are unclear).
- Issues in OpenClaw itself — please report those to the OpenClaw project.
- Social engineering of HITL approvers.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | ✅ |
| 1.1.x   | ✅ security fixes only |
| < 1.1   | ❌ |

Please upgrade to the latest 1.2.x patch release before filing a report.
