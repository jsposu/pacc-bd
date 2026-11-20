PACC-BD now uses the native Rust + Slint application as its primary implementation.

Downloads:

- Windows x64 portable `.exe`: place it in a writable folder. State and downloads
  are stored in `PACC-BD-data/rust` beside the executable.
- Linux x64 AppImage: run `chmod +x PACC-BD-*.AppImage`, then launch it. If FUSE
  is unavailable, use `APPIMAGE_EXTRACT_AND_RUN=1 ./PACC-BD-*.AppImage`.
- `SHA256SUMS`: verify with `sha256sum -c SHA256SUMS`.

This is a prerelease because Windows was built and smoke-tested by GitHub Actions,
not on the maintainer's local Windows hardware, and the binaries are unsigned.
The Rust application is nevertheless the primary implementation in the repository.
It never scans or modifies osu! libraries or resumes saved downloads without consent.
