# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Contact the
repository owner privately through the GitHub security-advisory flow so the
report can be reviewed before public disclosure.

Include the affected area, reproduction steps, impact, and a safe proof of
concept. Do not include private keys, wallet recovery phrases, payment data, or
personal information.

## Scope

Reports involving replay verification, wallet identity binding, ticket reuse,
reward qualification, authentication, server input validation, or exposed
secrets are especially useful. A client-displayed score is not authoritative;
please explain whether the issue can affect the verified result path.

## Supported versions

The `main` branch is the active development line. Security fixes are reviewed
before release and should not be mixed with unrelated gameplay changes.
