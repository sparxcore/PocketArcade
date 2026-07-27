# Repository Placement Guide

Place the licensing files at the root of the PocketArcade repository unless the tree below says otherwise.

```text
PocketArcade/
├── LICENSE
├── NOTICE
├── LICENSING.md
├── COMMERCIAL-LICENSING.md
├── TRADEMARKS.md
├── THIRD-PARTY-NOTICES.md
├── CONTRIBUTING.md
├── CONTRIBUTOR-LICENSE-AGREEMENT.md
├── LICENSE-HEADER.txt
├── README.md
├── .github/
│   └── PULL_REQUEST_TEMPLATE.md
└── docs/
    └── REPOSITORY-PLACEMENT.md
```

## Required root files

### `LICENSE`

Keep the official PolyForm Noncommercial License 1.0.0 text unmodified.

Do not add project-specific restrictions directly to this file.

### `NOTICE`

Keep this at repository root.

It contains the plain-text lines beginning with `Required Notice:` that recipients and redistributors are required to preserve under the public licence.

### `LICENSING.md`

Use this as the human-readable licensing overview.

It explains the dual-licensing model but does not replace `LICENSE`.

### `COMMERCIAL-LICENSING.md`

Use this to direct businesses and commercial users to:

`aigenuityltduk@gmail.com`

It does not itself grant commercial rights.

### `TRADEMARKS.md`

Keeps software permissions separate from product-name and branding permissions.

### `THIRD-PARTY-NOTICES.md`

Update this whenever dependencies, copied examples, fonts, artwork, sounds, or other third-party materials are added.

### `CONTRIBUTING.md`

Explains the contribution process and the need for an approved contributor agreement.

### `CONTRIBUTOR-LICENSE-AGREEMENT.md`

This is a starter template. Obtain legal review before accepting signatures or depending on it for relicensing.

### `LICENSE-HEADER.txt`

Use this as a source-file header template.

For C or C++ files:

```c
/*
 * Copyright © 2026 AIGENUITY LTD
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 *
 * Commercial licensing: aigenuityltduk@gmail.com
 */
```

For JavaScript:

```javascript
/*
 * Copyright © 2026 AIGENUITY LTD
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 *
 * Commercial licensing: aigenuityltduk@gmail.com
 */
```

For shell or Python files:

```text
# Copyright © 2026 AIGENUITY LTD
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# Commercial licensing: aigenuityltduk@gmail.com
```

Do not place the complete licence text in every source file.

## README placement

Copy the contents of `README-LICENSING-SNIPPET.md` into the lower part of the main `README.md`, normally before acknowledgements or contribution links.

The snippet file itself may then be deleted, or retained as a maintenance reference.

## Release archives

Every source or binary release should include, where applicable:

- `LICENSE`
- `NOTICE`
- `LICENSING.md`
- `THIRD-PARTY-NOTICES.md`
- Third-party licence files required by bundled dependencies

If a binary device image cannot practically display these files directly, make them available in the accompanying source archive, product documentation, distribution package, and system UI licensing screen.

## SD-card application packages

Each PocketArcade application package should eventually contain its own metadata, for example:

```text
apps/example-game/
├── manifest.json
├── LICENSE
├── NOTICE
├── THIRD-PARTY-NOTICES.md
├── client/
├── server/
└── assets/
```

Do not automatically assume that third-party game packages use the PocketArcade core licence.

## GitHub repository settings

In the repository description or About section, use wording such as:

> Standalone ESP32 multiplayer browser platform. Source-available for noncommercial use; commercial licensing available.

Avoid describing the project as “open source” because the public licence excludes commercial use.

## Before publishing

1. Replace placeholder dependency entries as code is added.
2. Check that AIGENUITY LTD owns or has permission to license all original code and assets.
3. Confirm the copyright year.
4. Review the contributor agreement with a UK intellectual-property solicitor.
5. Check the project name and branding for potential trademark conflicts.
6. Ensure releases preserve `LICENSE` and every `Required Notice:` line.
