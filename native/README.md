# PACC-BD native application

PACC-BD is a Rust + Slint desktop application. It has no Node, Electron, webview,
local HTTP server, collection editor, Songs scanner, or automatic osu! import.

## Run and test

```sh
cargo run
cargo run --release
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo run -- --smoke-test --data-dir /tmp/pacc-rust-smoke
cargo run -- --narrow --light --smoke-test --data-dir /tmp/pacc-rust-light
cargo run -- --scroll-test --data-dir /tmp/pacc-rust-scroll
```

Use `SLINT_BACKEND=winit-software` if OpenGL is unavailable. `--demo` loads local
fixtures and disables real transfers. `--theme 0..5`, `--narrow`, `--medium`,
`--advanced`, `--settings`, and `--screenshot PATH` support visual checks.

Opt-in live checks require Internet access:

```sh
cargo run -- --check-set 63834
cargo run -- --check-collection 24534
cargo run -- --smoke-live --data-dir /tmp/pacc-rust-live
cargo test live_mirror_download -- --ignored --nocapture
```

## Safety and state

Metadata and download URLs use HTTPS host allowlists and bounded redirects.
Downloads stream into create-new temporary files, have a 1 GiB transfer cap, and
are validated as ZIP archives before an atomic no-clobber commit. Validation
rejects unsafe paths, links, excessive entry counts, oversized expanded content,
and archives without a valid `.osu` difficulty. ZIP entries are never extracted.

Queue snapshots are replaced atomically. Corrupt or future state is reported and
left untouched. At launch, unfinished entries require explicit Recover or Discard
consent. Discard only removes saved queue records; it never deletes `.osz` files.

`--data-dir /absolute/path` selects an isolated profile. Windows release builds
default to `PACC-BD-data/rust` beside the executable. Other systems use the OS
local-data directory. Electron data is never read or migrated.

Cards and queue rows are viewport-windowed. Wide, medium and narrow windows use
three, two and one card columns at 1180 and 760 logical pixels.

## Licensing

Application code is MIT. Slint 1.19 is used under the Slint Royalty-free Desktop,
Mobile, and Web Applications License 2.0. Settings exposes the required
`AboutSlint` widget from the top-level interface. See the root notices.
