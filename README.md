# PACC-BD

**Panama Accuracy Collector & Beatmap Downloader** — a local community tool made by **osakari**, vibecoded. It previews public osu! Collector collections and tournament beatmap IDs, then downloads selected beatmapsets as `.osz` files. Its osu!-inspired design uses the [Panama Accuracy team banner and flag](https://osu.ppy.sh/teams/15959) served locally from `public/`. It is not an official osu! or osu! Collector app.

## Install (Windows / Linux)

Get the latest installers from **[GitHub Releases](https://github.com/jsposu/pacc-bd/releases/latest)**:

- **Windows 10/11, x64:** download `PACC-BD-*-windows-x64-setup.exe` and run the setup wizard. It creates Start menu and desktop shortcuts. Windows may show a SmartScreen warning because this community installer is **not code-signed**; check the download URL and SHA256 checksum before deciding whether to run it.
- **Linux, x64:** download `PACC-BD-*-linux-amd64.deb` to install through your package manager, or the portable `PACC-BD-*-linux-x86_64.AppImage` (make it executable with `chmod +x PACC-BD-*.AppImage` and run it). Some Linux distributions need the `libfuse2` compatibility library for AppImages; the `.deb` is an alternative.

No Node.js or browser installation is needed for the desktop builds. The app opens its own window and runs the local API on a random `127.0.0.1` port. An internet connection is still required to preview public maps and download `.osz` files. Release assets include `SHA256SUMS` for verifying downloads. Releases are built on the corresponding Windows and Linux GitHub Actions runners; **there are no macOS or ARM installers yet**.

## Run from source

Install Node.js **22+** and npm, then:

```bash
git clone https://github.com/jsposu/pacc-bd.git
cd pacc-bd
npm install
npm start
```

Open **http://127.0.0.1:4387**. The source server only listens on `127.0.0.1`; it needs internet access to public metadata services and the selected mirror. `npm run build:all` builds the UI and production API and checks TypeScript; `npm test` runs the tests. Change the source server's port with `PORT=4388`. For a local desktop window use `npm run desktop`.

## Use

The interface has two separate sections:

- **osu! Collector downloader:** Paste a public Collector collection URL or numeric collection ID, preview the collection, then search and select difficulty chips, whole sets, visible rows, or **Download all**.
- **Tournament IDs:** Paste up to **200** osu! beatmap (difficulty) IDs, beatmapset IDs, or `https://osu.ppy.sh/beatmaps/{id}` and `https://osu.ppy.sh/beatmapsets/{id}` links, separated by newlines, spaces, commas or semicolons. Links with `#osu/{difficultyId}` (or taiko/fruits/mania) specify a difficulty. Choose whether **plain numbers** are difficulty IDs or beatmapset IDs; links identify their own type. Preview first, review any unresolved IDs, select sets, and click **Download selected** or **Download all**. Previewing never starts a download.

Both sections share **one deduplicated queue**. If multiple difficulties belong to one beatmapset, only one `.osz` is downloaded; a `.osz` usually contains the entire set. Difficulty IDs and available checksums remain in saved previews. **Pause** allows the current file to finish but starts no new one; **Cancel** stops active work while preserving completed files; **Retry failed** retries using the configured mirror. The EN/ES language switch is saved locally in the browser. The sample Collector rows on first launch are fictional and cannot be downloaded.

By default, downloads go to `~/Downloads/PACC-BD` (Windows: `%USERPROFILE%\Downloads\PACC-BD`); change the absolute folder and public mirror in **Settings**. Import downloaded `.osz` files into osu! yourself. “Downloaded here” only means the saved file was verified by this app; it does not mean installed in osu!.

## Saved state and migration

- New state lives at `~/.pacc-bd/state.json` (Windows: `%USERPROFILE%\.pacc-bd\state.json`). Set `PACC_BD_DATA_DIR` to use another location. Existing `PANAMA_MAPS_DATA_DIR` and `AIMTHMUS_DATA_DIR` overrides still work.
- On first launch with the default state location, an existing `~/.panama-maps/state.json` is **copied**, not removed. If absent, the older `~/.aimthmus/state.json` is copied instead. Existing PACC-BD state is never replaced. Saved download folder settings and completed file paths remain unchanged, so upgrading does **not** move old downloads into the new default folder.
- Temporary files now use `*.osz.pacc-bd.part`. Interrupted legacy `.panama-maps.part` and `.aimthmus.part` files are also handled during recovery. The app never overwrites an existing `.osz`. A missing completed file is requeued; an invalid one fails visibly until moved or removed and retried.

## Services and limits

Tournament metadata comes from public osu! beatmap pages; no osu! authentication or paid API is used. An unauthenticated request to the official osu! `.osz` download URL redirected to a web page in testing, so `.osz` files use the **selected public mirror** (`osu.direct` by default; `catboy.best` opt-in). Only fixed upstream hosts/routes are requested; osu! page redirects and mirror redirects are restricted to approved hosts. osu! or mirrors may deny requests, remove maps, throttle requests or change their pages. The metadata resolver limits each paste to 200 unique IDs, paces page requests, bounds page size and follows `Retry-After` when short enough. Unresolved IDs are displayed rather than silently downloaded. Mirror downloads are serial with retry/backoff; the app does not switch mirrors to evade limits.

The app uses an osu!-inspired interface but is implemented independently. For Collector workflow and mirror caution, [osu-collector-dl](https://github.com/roogue/osu-collector-dl) and [osu-collect](https://github.com/uwuclxdy/osu-collect) were consulted. Source code is MIT-licensed; the Panama Accuracy artwork in `public/` comes from the team page and is **not** covered by that code license.

## Verify

Run `npm run build:all` and `npm test`. Tests cover ID parsing, osu! page metadata and redirects, failure reporting, shared-queue deduplication, legacy migration and partial recovery, Collector pagination, archive verification, cancellation, mirror limits, and production loopback security. A small live check previewed difficulty **188318**, displayed an unresolved ID, downloaded beatmapset **63834** (7,055,248 bytes) through osu.direct into an isolated test folder, validated the `.osz`, and confirmed that enqueueing it again added **zero** jobs. No bulk tournament downloads were run.

Release workflow: `.github/workflows/build.yml` builds and smoke-tests both platforms. Push a version tag such as `v1.0.0` to publish the tested installers and `SHA256SUMS` to GitHub Releases. For local Linux builds, run `npm run build:all` followed by `npm run dist:linux`. Windows installers are produced on the Windows runner with `npm run dist:win`.
