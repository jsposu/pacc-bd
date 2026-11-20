# Security and reliability review · 2026-11-20

This review does not claim that PACC-BD is free of vulnerabilities.

## Confirmed and fixed

- ZIP entry validation accepted Windows drive paths and alternate-data-stream
  syntax when running on Linux. Validation now applies platform-independent path
  rules and rejects ZIP symlinks. Regression coverage includes drive paths,
  traversal, backslashes, colons and symlinks.
- Very large finite API numbers could become infinite `f32` values in the UI.
  Numeric parsing now checks the destination range and IDs use the supported
  positive 32-bit range. A regression test covers both cases.
- `zip 4.6.1` had six RustSec advisories, including critical extraction issues.
  The lockfile now uses `zip 9.8.1`. PACC-BD never calls ZIP extraction APIs, but
  upgrading removes the vulnerable version rather than relying on that boundary.
- The Windows Rust executable had no portable-profile implementation. Release
  builds now use `PACC-BD-data/rust` beside the executable, with a regression test
  proving separation from the former Electron profile.
- The release workflow previously built Electron. It is replaced by Rust-only,
  least-privilege CI and release jobs with pinned third-party actions, a pinned
  and checksummed AppImage packaging tool, SHA-256 release checksums and build
  provenance attestations.

## Existing protections verified

- HTTPS URL and redirect host allowlists; no credentials, custom ports or HTTP.
- Bounded metadata bodies, cover decoding limits, request timeouts and bounded
  redirect count.
- Streamed downloads with a 1 GiB cap, bounded ZIP validation, entry-count and
  expanded-size limits, create-new temporary files and atomic no-clobber commit.
- FIFO queue deduplication, cooperative cancellation, retry limits, atomic queue
  snapshots and explicit startup recovery consent.
- Shell-free file-manager invocation and absolute, non-root destination checks.
- Malformed and future native state is reported without overwriting the source.

## Potential risks and pending checks

- Windows portable behavior is covered by unit tests and the GitHub Actions smoke
  test. It was not run on local Windows hardware.
- The Linux AppImage was built and smoke-tested locally with extract-and-run; CI
  builds on Ubuntu 22.04. Compatibility across other distributions remains a
  release-feedback item.
- Release binaries are not code-signed. Checksums and provenance help verify
  origin but do not replace platform signing.
- RustSec reports no known vulnerabilities after the ZIP upgrade. It still reports
  eight unmaintained transitive crates (`bincode`, `chrono`, `paste`, `pin-utils`,
  `ttf-parser`, `zbus_names`, `zvariant`, and `zvariant_derive`) without available
  fixed upgrades. They should be rechecked when Slint and its platform stack update.
- Live third-party APIs and mirrors can change behavior. Opt-in live checks exist,
  but release CI intentionally uses deterministic local fixtures rather than
  downloading public beatmaps.
