# PACC-BD · native Rust experimental app

Branch: **`rust-rewrite`**. Stable Electron development stays on `main`.
This executable uses Rust + Slint: no Node, Electron, webview or local HTTP server.
The old source remains here as a migration reference, not as a runtime dependency.

## Run

Install Rust with rustup, then from `native/`:

```sh
cargo run
```

First compilation installs the pinned toolchain and downloads Cargo dependencies.
Linux needs X11/Wayland and the system libraries for Slint's winit backend.
The default rendering path is now **FemtoVG / OpenGL**, with software fallback.
`cargo run` still uses a development build, but our code is optimized at level 1
and dependencies at level 2. The first rebuild therefore takes longer. For normal
performance comparisons use **`cargo run --release`**; Rust alone does not guarantee
better performance and these choices are not a hardware benchmark.

If OpenGL is unavailable, explicitly select `SLINT_BACKEND=winit-software`.

### Try actual downloads

1. In Collector, paste a public collection ID/URL and press **Preview**.
2. Or open Beatmap ID and paste up to 200 osu! IDs/links separated by spaces,
   commas or semicolons. Use the toggle to distinguish plain difficulty IDs from
   beatmapset IDs. A set link with `#osu/{id}` selects that difficulty's metadata.
3. Search and filter, select cards, or press a card's download arrow. Each job
   downloads the **whole beatmapset**, deduplicated across both sources.
4. Files are saved as `{beatmapset_id}.osz` in the configured folder. Import them
   into osu! yourself; the app **never imports archives automatically**.

**Download all sets** deliberately ignores filters. Selection stays set-based in
this milestone; the details panel shows individual difficulties and checksums are
retained in saved metadata for the later collection-management port.

Settings changes the absolute download folder, mirror (osu.direct / catboy.best),
and theme. Each queued item keeps its original destination folder. The chosen
mirror is read when a transfer starts. Title/cover links open the official osu!
beatmapset page. Click **details** to inspect individual unmodded stats.

**Open downloads** in the header opens the saved destination in the OS file
manager (shown as **Files** on narrow windows). If it does not exist yet, this
explicit action creates it. Unsaved path edits in Settings do not change the
destination. Opening runs off the UI thread and errors appear in the status note.

### Interface and scrolling

- Stars use the osu! spectrum, sheared double handles, readable high-star labels
  and an infinity upper bound. AR is red, OD orange, CS blue, HP green, length
  purple; BPM moves from blue to red. Mouse/touch and arrow/Home/End keys work.
- Controls have padded glass-like surfaces with visible outlines, focus/selected
  states, highlights and a **preblurred** artwork tint. This is not Apple's native
  Liquid Glass or a per-frame backdrop blur; avoiding that expensive filter is
  deliberate. Both the custom controls and standard widgets follow Light/Dark.
- Only a small viewport window of cards is instantiated, not the full collection.
  Off-screen controls are not painted. Placeholder pixels are shared between all
  maps (three textures), covers use smaller thumbnails and a 256-entry cache.
- Artwork updates change a single model row. Download byte progress does not reset
  the map model or rebuild the grid.

## Implemented

- Collector cursor pagination and deduplication; public osu! page metadata parsing;
  partial ID failures are reported instead of losing successful results.
- Three / two / one columns at 1180 / 760 logical pixels, artwork and native header,
  grid/list, title/artist/difficulty sorting, search and set-level selection.
- Double-ended stars, BPM, AR, OD, CS/keys, HP and drain-time ranges. General,
  mode and category filters. Conditions must match **the same difficulty**.
  Unknown values stay unknown and are excluded by active ranges unless enabled.
- Sequential, streamed downloads off the UI thread; known-size percentage or
  indeterminate progress; completed / total counts; FIFO queue with error details.
- **Pause** lets the current file finish. **Cancel** aborts active work and cancels
  waiting jobs; **Retry failed** resets failed entries. Clearing history never
  deletes archives and is blocked while work is outstanding.
- Transient request retries and bounded Retry-After handling. Unapproved redirect
  hosts are blocked. HTML/error responses, invalid ZIPs, archives without a valid
  `.osu`, truncated transfers, oversized files and unsafe entry names are rejected.
- Temporary files are create-new and removed on ordinary failure/cancellation.
  Archives commit atomically without overwriting existing files. No ZIP entries
  are extracted. Downloads have a 1 GiB safety cap and bounded validation budgets.
- Saved previews, queue, folder/mirror, language preference and theme; exclusive
  per-profile lock prevents two native instances writing the same state file.

## Queue recovery and isolation

At startup **the visible queue is empty**. Pending, interrupted and failed jobs
from the last session are offered in a **Recover / Discard** prompt. Nothing starts
before consent. Recover restarts unfinished files from zero in FIFO order;
Discard drops only saved pending jobs, not completed `.osz` files. Closing without
answering preserves the prompt. Completed/cancelled history is not restored.
Snapshots are saved when jobs change and before a transfer starts, using an atomic
file replacement. Invalid/future snapshots fail visibly rather than being erased.

The app prints its profile and download paths at launch. Default profile identity:
**pacc-bd-rust-preview**, in the OS local data directory; downloads default to its
`downloads/` child. `--data-dir /absolute/isolated/folder` selects another profile.
Settings may explicitly select another download destination. Native state is
`native-state.json`; the initial prototype's simulated `preview-queue.json` is
deliberately **not migrated into real downloads**.

The app never reads Electron's `.pacc-bd` / portable data, nor scans or edits your
osu! library. Cancellation during a blocked network operation may take up to its
15-second timeout. A forced process termination can leave our `.part` files;
they are never mistaken for completed maps or used for byte-range resumption.
If `{id}.osz` already exists, a new download fails safely instead of overwriting it;
move the existing archive elsewhere before retrying if you really need another copy.

## Tests and diagnostics

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo run -- --smoke-test --data-dir /tmp/opencode/pacc-rust-smoke
cargo run -- --narrow --light --smoke-test --data-dir /tmp/opencode/pacc-rust-smoke-light
cargo run -- --scroll-test --data-dir /tmp/opencode/pacc-rust-scroll-test
```

Normal tests use generated `.osz` fixtures / loopback HTTP, not public downloads.
The scroll regression creates 10,000 **fixture** maps and checks that the number
of instantiated card trees stays viewport-bounded while scrolling top to bottom.
Its event-loop timer samples are diagnostics, **not measured rendering FPS**.
`--stress` opens the same large fixture interactively. These modes never transfer
maps or write fake jobs into the real queue.
Opt-in live checks (internet required):

```sh
cargo run -- --check-set 63834
cargo run -- --check-collection 24534
cargo run -- --smoke-live --data-dir /tmp/opencode/pacc-rust-live-ui
cargo test live_mirror_download -- --ignored --nocapture
```

The live download test saves one real set in an automatically removed temporary
directory, not your configured download folder. Public test IDs can disappear.
The dedicated native GitHub workflow runs Windows/Linux tests without publishing.

### Visual fixtures

```sh
python3 tools/fetch-reference-assets.py
cargo run -- --demo
cargo run -- --demo --screenshot /tmp/opencode/pacc-rust.png
cargo run -- --demo --advanced --scroll-to 350 --light --screenshot /tmp/opencode/pacc-rust-filters.png
```

While showing fixture data, `--demo`, `--stress` and the smoke checks disable real
transfers, including recovery. Loading a real source explicitly leaves interactive
demo mode; fixtures themselves can never be queued as real songs.
Fixture songs/stats are illustrative. Optional reference covers and original
DM Sans/Outfit fonts stay in ignored `demo-covers/`. Covers are third-party osu!
artwork used only for local comparison, not licensed as our code or bundled in a
release. Fonts include their SIL OFL notices. Without them the app uses procedural
placeholder covers and system fonts; downloaded maps get their own live artwork.
The existing team icon retains the rights described in the root notices.

On fractional-DPI Wayland displays, use `SLINT_SCALE_FACTOR=1` for deterministic
screenshots. The capture diagnostic reports an unsettled resize instead of
calling Slint's software snapshot renderer with a too-small buffer.

## Still pending — not a complete migration yet

- Collection.db editing, Songs scan and lazer export are **not connected**; the
  Collections tab explicitly states this. Backups and safety checks must be ported
  and tested with disposable libraries before enabling edits.
- Complete EN/ES labels, per-difficulty selection, recent collection history,
  native update checks, zoom, exact visual parity and accessibility polish.
- Persistent artwork cache / lazy loading (currently up to 150 covers per preview),
  explicit backup-first import of Electron settings, performance benchmarks and
  Windows portable / Linux release packaging.

## Licensing

Our source remains MIT. Slint 1.19 offers GPLv3, Slint Royalty-free 2.0 or commercial
licensing; this desktop experiment uses **Slint Royalty-free 2.0**, with a visible
`AboutSlint` widget in Settings. Slint itself is not MIT. Review all exact dependency
licenses and third-party notices before distributing native binaries.
