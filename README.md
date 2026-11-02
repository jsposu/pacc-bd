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

Switch sections using the tabs in the upper-left corner; only the selected downloader is shown:

- **osu! Collector downloader:** Paste a public Collector collection URL or numeric collection ID, preview the collection, then search and select difficulty chips, whole sets, visible rows, or **Download all**.
- **Beatmap ID:** Paste up to **200** osu! beatmap (difficulty) IDs, beatmapset IDs, or `https://osu.ppy.sh/beatmaps/{id}` and `https://osu.ppy.sh/beatmapsets/{id}` links, separated by newlines, spaces, commas or semicolons. Links with `#osu/{difficultyId}` (or taiko/fruits/mania) specify a difficulty. Choose whether **plain numbers** are difficulty IDs or beatmapset IDs; links identify their own type. Preview first, review any unresolved IDs, select sets, and click **Download selected** or **Download all**. Previewing never starts a download.

Both downloaders have star-rating and BPM range sliders. They narrow the displayed difficulties and **Select visible**; **Download all** deliberately ignores filters. Set-only IDs use the resolved difficulties in the set. Unknown stats are marked explicitly and can be included while filtering. The Collector preview also links back to the original public collection page.

Both sections share **one deduplicated queue**. If multiple difficulties belong to one beatmapset, only one `.osz` is downloaded; a `.osz` usually contains the entire set. Difficulty IDs and available checksums remain in saved previews. **Pause** allows the current file to finish but starts no new one; **Cancel** stops active work while preserving completed files; **Retry failed** retries using the configured mirror. **Clear queue history** removes queue entries, not `.osz` files; cancel pending downloads and wait for an active transfer to stop before clearing. The EN/ES language switch is saved locally in the browser. **Clear recent** removes saved Collector previews only; it leaves the queue and downloaded files untouched.

Use **Check updates** in the header to compare your installed version with the latest published GitHub Release. If a newer version is available, review its notes and open the release to download an installer. This is a manual update check; it never replaces the running app, installs files silently or changes your library. It checks releases, not untested commits on `main`, and requires internet access.

By default, downloads go to `~/Downloads/PACC-BD` (Windows: `%USERPROFILE%\Downloads\PACC-BD`); change the absolute folder and public mirror in **Settings**. Import downloaded `.osz` files into osu! yourself. “Downloaded here” only means the saved file was verified by this app; it does not mean installed in osu!.

The separate **Settings** view also has three saved themes: **Dark Theme** (Monokai-inspired charcoal and Panama pink), **Light Theme**, and **Oled Theme**. The chosen theme is kept in PACC-BD's local state across desktop launches.

### Manage osu!stable collections

Open the separate **Collections** view from the upper-right header (or the button beside a downloader preview). First, choose the **osu!stable installation folder** containing `collection.db` and `Songs`, not the download folder. In osu!stable you can find it via **Options → Open osu! folder**. Choose or create a collection, then switch between saved **Collector** and **Beatmap ID** preview lists. Installed difficulties are labelled and can be added; maps not yet imported are labelled and cannot be added. If a preview map cannot be matched, import its downloaded `.osz` into osu!stable first, then use **Refresh Songs**. Set-only ID previews expand to the installed difficulties in that set after import. You can also search Songs directly, rename collections or remove entries without deleting beatmap files. PACC-BD matches osu!stable beatmaps using MD5 checksums of installed `.osu` files; a downloaded `.osz` alone cannot be added. There is **no automatic import**.

Collection members, saved previews and Songs search show beatmap artwork when available and have star/BPM filters. Drag an **installed** map onto a collection name or the current collection's drop zone, or use **Add** for keyboard and touch input; **Add visible installed maps** supports bulk additions without checkboxes. Missing stars stay unknown unless the map has a rating in a saved preview. Installed BPM is read from the first uninherited timing point in its `.osu` file when available.

**Close osu!stable before editing** and tick the confirmation checkbox. The app checks for a running `osu!.exe`, refuses stale database revisions and malformed databases, and saves a copy of the original `collection.db` to `~/.pacc-bd/stable-backups/` (Windows: `%USERPROFILE%\.pacc-bd\stable-backups\`) **before every edit**. If `PACC_BD_DATA_DIR` is set, backups go to its `stable-backups/` folder. Changes to the game database are written through a temporary file. Keep your own additional backups, especially before editing a real library; reopen osu!stable after edits to see the changes. This feature targets **osu!stable**, not osu!lazer.

## Saved state and migration

- New state lives at `~/.pacc-bd/state.json` (Windows: `%USERPROFILE%\.pacc-bd\state.json`). Set `PACC_BD_DATA_DIR` to use another location. Existing `PANAMA_MAPS_DATA_DIR` and `AIMTHMUS_DATA_DIR` overrides still work.
- On first launch with the default state location, an existing `~/.panama-maps/state.json` is **copied**, not removed. If absent, the older `~/.aimthmus/state.json` is copied instead. Existing PACC-BD state is never replaced. Saved download folder settings and completed file paths remain unchanged, so upgrading does **not** move old downloads into the new default folder.
- Temporary files now use `*.osz.pacc-bd.part`. Interrupted legacy `.panama-maps.part` and `.aimthmus.part` files are also handled during recovery. The app never overwrites an existing `.osz`. A missing completed file is requeued; an invalid one fails visibly until moved or removed and retried.

## Services and limits

Tournament metadata comes from public osu! beatmap pages; no osu! authentication or paid API is used. An unauthenticated request to the official osu! `.osz` download URL redirected to a web page in testing, so `.osz` files use the **selected public mirror** (`osu.direct` by default; `catboy.best` opt-in). Only fixed upstream hosts/routes are requested; osu! page redirects and mirror redirects are restricted to approved hosts. osu! or mirrors may deny requests, remove maps, throttle requests or change their pages. The metadata resolver limits each paste to 200 unique IDs, paces page requests, bounds page size and follows `Retry-After` when short enough. Unresolved IDs are displayed rather than silently downloaded. Mirror downloads are serial with retry/backoff; the app does not switch mirrors to evade limits.

The interface takes visual inspiration from osu!'s website (compact navigation, layered surfaces and artwork-led beatmap cards), but is implemented independently. For Collector workflow and mirror caution, [osu-collector-dl](https://github.com/roogue/osu-collector-dl) and [osu-collect](https://github.com/uwuclxdy/osu-collect) were consulted. The unmodified [official osu! cookie logo](https://github.com/ppy/osu-web/blob/master/public/images/layout/osu-logo%402x.png) in `public/osu-logo.png` is used according to [osu!'s branding guidelines](https://osu.ppy.sh/wiki/en/Brand_identity_guidelines); it and the Panama Accuracy team artwork in `public/` are **not** covered by the MIT code license.

## Verify

Run `npm run build:all` and `npm test`. Tests cover ID parsing, osu! page metadata and redirects, failure reporting, shared-queue deduplication, legacy migration and partial recovery, Collector pagination, archive verification, cancellation, mirror limits, production loopback security, isolated osu!stable database edits/backups and installed-map matching from both saved preview sources, release checks, saved themes, and queue clearing without deleting downloads. A small live check previewed difficulty **188318**, displayed an unresolved ID, downloaded beatmapset **63834** (7,055,248 bytes) through osu.direct into an isolated test folder, validated the `.osz`, and confirmed that enqueueing it again added **zero** jobs. No bulk tournament downloads were run.

Release workflow: `.github/workflows/build.yml` builds and smoke-tests both platforms. Push a version tag such as `v1.3.1` to publish the tested installers and `SHA256SUMS` to GitHub Releases. For local Linux builds, run `npm run build:all` followed by `npm run dist:linux`; smoke-test the unpacked app with `xvfb-run -a release/linux-unpacked/pacc-bd --no-sandbox --smoke-test`, or use `--ozone-platform=headless` instead of `xvfb-run` where supported. Windows installers are produced on the Windows runner with `npm run dist:win`.
