# Contributing to PocketArcade

Thank you for considering a contribution.

PocketArcade uses a dual-licensing model: noncommercial public licensing and separately negotiated commercial licensing. AIGENUITY LTD must therefore retain the legal ability to distribute accepted contributions under both models.

## Before contributing

By opening an issue, you may provide ideas, bug reports, and feedback.

Before a substantive code, documentation, design, asset, protocol, or test contribution can be merged, the contributor must agree to the contributor licence agreement approved for this project.

See [`CONTRIBUTOR-LICENSE-AGREEMENT.md`](CONTRIBUTOR-LICENSE-AGREEMENT.md).

The included agreement is a repository template and should be legally reviewed before the project begins collecting external signatures.

## Contribution process

1. Open an issue describing the proposed change.
2. Confirm that the work is not confidential and can lawfully be contributed.
3. Create a focused branch.
4. Add or update tests.
5. Update relevant documentation.
6. Record any new dependency in `THIRD-PARTY-NOTICES.md`.
7. Submit a pull request.
8. Complete the approved contributor agreement when requested.

## Rights and originality

Do not submit material:

- Owned exclusively by an employer or client without permission
- Copied from another project without compatible licensing
- Generated from confidential or unlawfully obtained material
- Containing secrets, credentials, personal data, or private keys
- Subject to terms that prevent dual licensing by AIGENUITY LTD

Clearly identify any third-party or jointly owned material.

## Dependencies

Do not add a new dependency merely for convenience.

A pull request adding a dependency must explain:

- Why it is needed
- Its source and version
- Its licence
- Its expected binary and memory cost
- Whether it is copied, linked, bundled, downloaded, or only used during development

Strong-copyleft or otherwise restrictive dependencies require prior written approval.

## Coding expectations

Contributions should:

- Build with the documented ESP-IDF version
- Keep board-specific code isolated
- Avoid blocking realtime network paths
- Bound memory and message sizes
- Include error handling
- Include tests where practical
- Preserve user privacy
- Avoid exposing raw MAC addresses, tokens, or profile secrets

## No obligation to accept

Submission does not guarantee acceptance. AIGENUITY LTD may decline, revise, postpone, or close a contribution for technical, product, legal, security, maintenance, or licensing reasons.
