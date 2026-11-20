# PACC-BD user guide

PACC-BD offers two sources. **osu! Collector Downloader** accepts a public
collection ID or `https://osucollector.com/collections/...` URL. **Download by
Beatmap ID** accepts up to 200 osu! difficulty IDs, beatmapset IDs, or official
osu! links separated by spaces, commas, or semicolons.

Preview a source, apply filters, select maps, and add them to the queue. Downloads
always contain the complete beatmapset and are deduplicated by beatmapset ID.
**Download all sets** deliberately ignores active filters.

The queue runs in FIFO order. Pause waits for the active transfer to finish;
Cancel aborts it and cancels waiting entries. Failed items can be retried. On the
next launch the visible queue starts empty and PACC-BD asks before recovering
unfinished entries. It never resumes them automatically.

Files are stored as `{beatmapset_id}.osz`. Existing files are never overwritten.
Use **Open downloads** to open the configured folder, then import archives into
osu! yourself. PACC-BD never scans or edits `Songs`, `collection.db`, or lazer
libraries.

Settings contains the destination folder, mirror and six themes. Light uses opaque
reading surfaces and stronger outlines; the other choices are Dark, osu! Pink,
Midnight, Forest and Sepia. The theme choice persists in the native profile.

On Windows, place the portable `.exe` in a writable folder. Native state and
default downloads live under `PACC-BD-data/rust` beside it. On Linux, make the
AppImage executable with `chmod +x` and run it. Some distributions require
`libfuse2`; `APPIMAGE_EXTRACT_AND_RUN=1 ./PACC-BD-*.AppImage` is the fallback.

The Windows executable is currently unsigned, so SmartScreen may warn. Compare
downloads with `SHA256SUMS` from the release before running them.
