use crate::{AppWindow, FilterRange, MapCard, UiPalette, visuals};
use pacc_bd_native::{
    desktop, download,
    model::{BeatmapSet, Difficulty, Download, Filters, Mirror, Range, Status, Store},
    network,
};
use slint::{ComponentHandle, Model, ModelRc, VecModel};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    io,
    path::PathBuf,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    thread,
    time::{Duration, Instant},
};

enum Event {
    Loaded(i32, network::Result<(String, Vec<BeatmapSet>, Vec<String>)>),
    Cover(u64, visuals::Cover),
    Progress(u64, u64, Option<u64>),
    Message(u64, String),
    Finished(u64, network::Result<PathBuf>),
    FolderOpened(network::Result<()>),
}
struct Running {
    id: u64,
    cancel: Arc<AtomicBool>,
    thread: thread::JoinHandle<network::Result<PathBuf>>,
}
struct State {
    store: Store,
    profile: PathBuf,
    recovery: Vec<Download>,
    selected: HashSet<u64>,
    filters: Filters,
    ranges: Vec<FilterRange>,
    covers: HashMap<u64, (slint::Image, slint::Image)>,
    cover_order: VecDeque<u64>,
    placeholders: Vec<(slint::Image, slint::Image)>,
    view_positions: HashMap<u64, usize>,
    client: reqwest::blocking::Client,
    sender: Sender<Event>,
    running: Option<Running>,
    paused: bool,
    busy: bool,
    successful_loads: usize,
    demo: bool,
    demo_sets: Vec<BeatmapSet>,
    next_start: Instant,
}

fn locked_downloads(queue: &[Download], running: Option<u64>) -> HashSet<u64> {
    queue
        .iter()
        .filter(|item| item.status != Status::Cancelled)
        .map(|item| item.id)
        .chain(running)
        .collect()
}

impl State {
    fn groups(&self, page: i32) -> &[BeatmapSet] {
        if self.demo {
            &self.demo_sets
        } else if page == 1 {
            &self.store.ids
        } else {
            &self.store.collector
        }
    }
    fn persist(&mut self, ui: &AppWindow) -> bool {
        let mut snapshot = self.store.clone();
        if !self.recovery.is_empty() {
            snapshot.queue = self.recovery.clone();
        }
        if let Err(error) = snapshot.save(&self.profile) {
            eprintln!("Cannot save native state: {error}");
            self.paused = true;
            ui.set_notice(format!("Cannot save native state; queue paused: {error}").into());
            false
        } else {
            true
        }
    }
    fn ui_filters(&mut self, ui: &AppWindow) {
        self.filters.ranges[0] = Range {
            min: ui.get_star_min(),
            max: (ui.get_star_max() < 10.0).then(|| ui.get_star_max()),
        };
        self.filters.mode = ["", "osu", "taiko", "fruits", "mania"]
            .get(ui.get_mode_index() as usize)
            .unwrap_or(&"")
            .to_string();
        self.filters.status = [
            "",
            "ranked",
            "approved",
            "qualified",
            "loved",
            "pending",
            "wip",
            "graveyard",
        ]
        .get(ui.get_status_index() as usize)
        .unwrap_or(&"")
        .to_string();
        self.filters.exclude_converted = ui.get_exclude_converted();
        self.filters.featured = ui.get_featured();
        self.filters.unknown = ui.get_include_unknown();
    }
    fn insert_cover(&mut self, id: u64, pair: (slint::Image, slint::Image)) {
        if !self.covers.contains_key(&id) {
            self.cover_order.push_back(id);
        }
        self.covers.insert(id, pair);
        while self.cover_order.len() > 256 {
            if let Some(old) = self.cover_order.pop_front() {
                self.covers.remove(&old);
            }
        }
    }
    fn refresh(&mut self, ui: &AppWindow) {
        let locked = locked_downloads(&self.store.queue, self.running.as_ref().map(|job| job.id));
        let query = ui.get_search().to_string();
        let mut sets: Vec<_> = self
            .groups(ui.get_page())
            .iter()
            .filter(|set| self.filters.matches(set, &query))
            .collect();
        match ui.get_sort_index() {
            1 => sets.sort_by_key(|set| set.title.to_lowercase()),
            2 => sets.sort_by_key(|set| set.artist.to_lowercase()),
            3 => sets.sort_by(|a, b| highest(b).total_cmp(&highest(a))),
            _ => {}
        }
        ui.set_ambience(
            sets.first()
                .and_then(|set| self.covers.get(&set.id))
                .map(|(_, glow)| glow.clone())
                .unwrap_or_default(),
        );
        let maps: Vec<_> = sets
            .into_iter()
            .map(|set| {
                let (cover, glow) = self
                    .covers
                    .get(&set.id)
                    .cloned()
                    .unwrap_or_else(|| self.placeholders[(set.id % 3) as usize].clone());
                let queued = locked.contains(&set.id);
                let diffs = self.filters.matching_difficulties(set, &query);
                let stars = diffs
                    .iter()
                    .filter_map(|diff| diff.stars)
                    .fold(-1.0, f32::max);
                let modes: HashSet<_> = diffs.iter().map(|diff| diff.mode.as_str()).collect();
                MapCard {
                    id: set.id as i32,
                    title: set.title.clone().into(),
                    artist: set.artist.clone().into(),
                    mapper: set.creator.clone().into(),
                    stars,
                    cover,
                    glow,
                    selected: self.selected.contains(&set.id),
                    status: set.status.to_uppercase().into(),
                    summary: format!(
                        "{} / {} difficulties · {} · details ⌄",
                        diffs.len(),
                        set.difficulties.len(),
                        if stars >= 0.0 {
                            format!("{stars:.2}★")
                        } else {
                            "Unknown stars".into()
                        }
                    )
                    .into(),
                    downloadable: !self.demo && !queued && self.recovery.is_empty(),
                    mode: if modes.len() == 1 {
                        modes.iter().next().unwrap().to_string().into()
                    } else {
                        "mixed".into()
                    },
                    ratings: ModelRc::new(VecModel::from(
                        diffs
                            .iter()
                            .take(14)
                            .map(|diff| diff.stars.unwrap_or(-1.0))
                            .collect::<Vec<_>>(),
                    )),
                }
            })
            .collect();
        self.view_positions = maps
            .iter()
            .enumerate()
            .map(|(index, map)| (map.id as u64, index))
            .collect();
        ui.set_maps(ModelRc::new(VecModel::from(maps)));
        ui.set_selected_count(self.selected.len() as i32);
        ui.set_live(!self.demo);
        ui.set_busy(self.busy);
        ui.set_paused(self.paused);
        ui.set_collection_name(if self.demo {
            "Illustrative fixture maps · downloads disabled".into()
        } else if ui.get_page() == 1 {
            "Resolved osu! beatmap IDs".into()
        } else {
            self.store.collection_name.clone().into()
        });
        self.refresh_queue(ui);
    }
    fn refresh_queue(&self, ui: &AppWindow) {
        ui.set_download_location(self.store.directory.to_string_lossy().into_owned().into());
        ui.set_paused(self.paused);
        ui.set_queue_count(self.store.queue.len() as i32);
        let done = self
            .store
            .queue
            .iter()
            .filter(|item| item.status == Status::Done)
            .count();
        ui.set_completed(done as i32);
        ui.set_recovery_count(self.recovery.len() as i32);
        ui.set_queue_titles(ModelRc::new(VecModel::from(
            self.store
                .queue
                .iter()
                .map(|item| {
                    format!(
                        "{} · {}{}",
                        match item.status {
                            Status::Pending => "Waiting",
                            Status::Downloading => "Downloading",
                            Status::Done => "Completed",
                            Status::Failed => "Failed",
                            Status::Cancelled => "Cancelled",
                        },
                        item.title,
                        if item.error.is_empty() {
                            String::new()
                        } else {
                            format!(" · {}", item.error)
                        }
                    )
                    .into()
                })
                .collect::<Vec<_>>(),
        )));
        self.refresh_transfer(ui);
    }
    fn refresh_transfer(&self, ui: &AppWindow) {
        if let Some(item) = self
            .store
            .queue
            .iter()
            .find(|item| item.status == Status::Downloading)
        {
            ui.set_queue_summary(format!("Downloading: {}", item.title).into());
            ui.set_progress(
                item.total
                    .map(|total| {
                        (item.bytes as f64 / total as f64 * 100.0).clamp(0.0, 100.0) as f32
                    })
                    .unwrap_or(-1.0),
            );
            ui.set_transfer_label(
                format!(
                    "{}{}",
                    if let Some(total) = item.total {
                        format!(
                            "{:.1} / {:.1} MB",
                            item.bytes as f64 / 1048576.0,
                            total as f64 / 1048576.0
                        )
                    } else {
                        format!("{:.1} MB · size unknown", item.bytes as f64 / 1048576.0)
                    },
                    if item.error.is_empty() {
                        String::new()
                    } else {
                        format!(" · {}", item.error)
                    }
                )
                .into(),
            );
        } else if self.running.is_some() {
            ui.set_queue_summary("Cancelling active transfer…".into());
            ui.set_transfer_label("Waiting for the network operation to stop".into());
            ui.set_progress(-1.0);
        } else {
            ui.set_queue_summary(
                if self.paused {
                    "PAUSED"
                } else if self
                    .store
                    .queue
                    .iter()
                    .any(|item| item.status == Status::Failed)
                {
                    "Some downloads failed · expand queue"
                } else {
                    "READY · Download queue"
                }
                .into(),
            );
            ui.set_transfer_label(
                "One .osz contains the entire set · import manually into osu!".into(),
            );
            ui.set_progress(if self.store.queue.is_empty() {
                0.0
            } else {
                ui.get_completed() as f32 / self.store.queue.len() as f32 * 100.0
            });
        }
    }
    fn enqueue(&mut self, ui: &AppWindow, ids: Vec<u64>) {
        if self.demo {
            ui.set_notice("Load real maps first; fixtures cannot be downloaded".into());
            return;
        }
        if !self.recovery.is_empty() {
            ui.set_notice("Choose Recover or Discard before adding downloads".into());
            return;
        }
        let wanted: HashSet<_> = ids.into_iter().collect();
        let locked = locked_downloads(&self.store.queue, self.running.as_ref().map(|job| job.id));
        let sets: Vec<_> = self
            .groups(ui.get_page())
            .iter()
            .filter(|set| wanted.contains(&set.id) && !locked.contains(&set.id))
            .cloned()
            .collect();
        for set in sets {
            self.store.enqueue(&set);
        }
        self.persist(ui);
        self.refresh(ui);
    }
    fn refresh_downloadable(&self, ui: &AppWindow, id: u64) {
        let Some(index) = self.view_positions.get(&id).copied() else {
            return;
        };
        let model = ui.get_maps();
        if let Some(rows) = model.as_any().downcast_ref::<VecModel<MapCard>>()
            && let Some(mut row) = rows.row_data(index)
        {
            row.downloadable = !self.demo
                && self.recovery.is_empty()
                && !locked_downloads(&self.store.queue, self.running.as_ref().map(|job| job.id))
                    .contains(&id);
            rows.set_row_data(index, row);
        }
    }
    fn drive(&mut self, ui: &AppWindow) {
        if self.demo
            || self.paused
            || self.running.is_some()
            || !self.recovery.is_empty()
            || Instant::now() < self.next_start
        {
            return;
        }
        let Some(index) = self
            .store
            .queue
            .iter()
            .position(|item| item.status == Status::Pending)
        else {
            return;
        };
        self.store.queue[index].status = Status::Downloading;
        if !self.persist(ui) {
            self.store.queue[index].status = Status::Pending;
            self.refresh_queue(ui);
            return;
        }
        let item = self.store.queue[index].clone();
        let id = item.id;
        let directory = item
            .directory
            .unwrap_or_else(|| self.store.directory.clone());
        let mirror = self.store.mirror;
        let client = self.client.clone();
        let sender = self.sender.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let thread = thread::spawn(move || {
            let result = download::run(
                &client,
                mirror,
                id,
                &directory,
                &flag,
                |bytes, total| {
                    let _ = sender.send(Event::Progress(id, bytes, total));
                },
                |message| {
                    let _ = sender.send(Event::Message(id, message));
                },
            );
            let _ = sender.send(Event::Finished(id, result.clone()));
            result
        });
        self.running = Some(Running { id, cancel, thread });
        self.refresh_queue(ui);
    }
}

fn update_cover_row(
    model: &ModelRc<MapCard>,
    index: usize,
    pair: &(slint::Image, slint::Image),
) -> bool {
    if let Some(rows) = model.as_any().downcast_ref::<VecModel<MapCard>>()
        && let Some(mut row) = rows.row_data(index)
    {
        row.cover = pair.0.clone();
        row.glow = pair.1.clone();
        rows.set_row_data(index, row);
        return true;
    }
    false
}

fn handle_event(state: &mut State, ui: &AppWindow, event: Event) {
    match event {
        Event::Loaded(page, result) => {
            state.busy = false;
            match result {
                Ok((name, sets, errors)) => {
                    state.successful_loads += 1;
                    let count = sets.len();
                    if page == 0 {
                        state.store.collection_name = name;
                        state.store.collector = sets;
                    } else {
                        state.store.ids = sets;
                    }
                    state.demo = false;
                    state.selected.clear();
                    let saved = state.persist(ui);
                    ui.set_source_open(count == 0);
                    let note = if errors.is_empty() {
                        "Select maps to download .osz files; import manually.".to_owned()
                    } else {
                        format!("Some IDs failed: {}", errors.join("; "))
                    };
                    if saved {
                        ui.set_notice(format!("Loaded {count} sets. {note}").into());
                    }
                }
                Err(error) => ui.set_notice(error.into()),
            }
        }
        Event::Cover(id, cover) => {
            let pair = visuals::images(cover);
            state.insert_cover(id, pair.clone());
            // One row update, not a model reset / full-grid layout per image.
            if let Some(index) = state.view_positions.get(&id).copied() {
                let model = ui.get_maps();
                update_cover_row(&model, index, &pair);
                if index == 0 {
                    ui.set_ambience(pair.1);
                }
            }
        }
        Event::FolderOpened(result) => match result {
            Ok(()) => ui.set_notice("Opened the configured download folder.".into()),
            Err(error) => ui.set_notice(format!("Cannot open download folder: {error}").into()),
        },
        Event::Progress(id, bytes, total) => {
            if let Some(item) = state
                .store
                .queue
                .iter_mut()
                .find(|item| item.id == id && item.status == Status::Downloading)
            {
                item.bytes = bytes;
                item.total = total;
            }
        }
        Event::Message(id, message) => {
            if let Some(item) = state.store.queue.iter_mut().find(|item| item.id == id) {
                item.error = message;
            }
        }
        Event::Finished(id, result) => {
            if let Some(item) = state.store.queue.iter_mut().find(|item| item.id == id) {
                match result {
                    Ok(file) => {
                        item.status = Status::Done;
                        item.file = Some(file);
                        item.error.clear();
                    }
                    Err(error) => {
                        item.status = if error == "Cancelled" {
                            Status::Cancelled
                        } else {
                            Status::Failed
                        };
                        item.error = error;
                    }
                }
            }
            if state
                .running
                .as_ref()
                .is_some_and(|running| running.id == id)
                && let Some(running) = state.running.take()
            {
                let _ = running.thread.join();
            }
            state.next_start = Instant::now() + Duration::from_millis(1600);
            state.persist(ui);
            state.refresh_downloadable(ui, id);
        }
    }
}

fn highest(set: &BeatmapSet) -> f32 {
    set.difficulties
        .iter()
        .filter_map(|d| d.stars)
        .fold(-1.0, f32::max)
}
fn ranges() -> Vec<FilterRange> {
    [
        ("BPM", 400.0),
        ("AR", 11.0),
        ("OD", 11.0),
        ("CS / Keys", 18.0),
        ("HP", 11.0),
        ("Length (seconds)", 1200.0),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (label, limit))| FilterRange {
        label: label.into(),
        key: index as i32 + 1,
        lower: 0.0,
        upper: limit,
        limit,
    })
    .collect()
}

fn fixtures() -> Vec<BeatmapSet> {
    [
        (
            63834,
            "Everything will freeze",
            "UNDEAD CORPORATION",
            "Ekoro",
            4.7,
        ),
        (39804, "FREEDOM DiVE", "xi", "Nakagawa-Kanon", 5.8),
        (320118, "Blue Zenith", "xi", "Asphyxia", 6.4),
        (
            63835,
            "Visual fixture · Stream practice",
            "Preview artist",
            "Preview mapper",
            3.2,
        ),
        (
            63836,
            "Visual fixture · Accuracy",
            "Preview artist",
            "Preview mapper",
            4.2,
        ),
        (
            63837,
            "Visual fixture · Rhythm",
            "Preview artist",
            "Preview mapper",
            7.1,
        ),
    ]
    .into_iter()
    .map(|(id, title, artist, creator, stars)| BeatmapSet {
        id,
        title: title.into(),
        artist: artist.into(),
        creator: creator.into(),
        status: "ranked".into(),
        featured_artist: false,
        difficulties: vec![Difficulty {
            id,
            version: "Illustrative difficulty".into(),
            mode: "osu".into(),
            stars: Some(stars),
            ..Default::default()
        }],
    })
    .collect()
}

fn start_covers(client: reqwest::blocking::Client, sender: Sender<Event>, sets: Vec<BeatmapSet>) {
    thread::spawn(move || {
        for set in sets.into_iter().take(150) {
            if let Ok(cover) = network::cover(&client, set.id).and_then(visuals::decode) {
                let _ = sender.send(Event::Cover(set.id, cover));
            }
        }
    });
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--smoke-live") && !args.iter().any(|arg| arg == "--data-dir") {
        return Err("--smoke-live requires an isolated --data-dir".into());
    }
    if args.iter().any(|arg| arg == "--scroll-test") && !args.iter().any(|arg| arg == "--data-dir")
    {
        return Err("--scroll-test requires an isolated --data-dir".into());
    }
    let client = network::client().map_err(io::Error::other)?;
    if let Some(index) = args.iter().position(|arg| arg == "--check-collection") {
        let id = network::collection_id(args.get(index + 1).ok_or("Missing collection ID")?)
            .map_err(io::Error::other)?;
        let (name, sets) = network::collector(&client, id).map_err(io::Error::other)?;
        println!(
            "{name}: {} sets, {} difficulties",
            sets.len(),
            sets.iter().map(|set| set.difficulties.len()).sum::<usize>()
        );
        return Ok(());
    }
    if let Some(index) = args.iter().position(|arg| arg == "--check-set") {
        let id = args.get(index + 1).ok_or("Missing set ID")?.parse()?;
        let (sets, errors) = network::resolve(&client, vec![network::OsuId { id, set: true }])
            .map_err(io::Error::other)?;
        println!("{} sets resolved; {} errors", sets.len(), errors.len());
        for set in sets {
            println!(
                "{}: {} · {} difficulties",
                set.id,
                set.title,
                set.difficulties.len()
            );
        }
        for error in &errors {
            eprintln!("{error}");
        }
        if !errors.is_empty() {
            return Err("Metadata lookup failed".into());
        }
        return Ok(());
    }
    let directory = match args.iter().position(|arg| arg == "--data-dir") {
        Some(index) => std::path::absolute(
            args.get(index + 1)
                .ok_or("--data-dir requires a directory")?,
        )?,
        None => directories::ProjectDirs::from("io", "jsposu", "pacc-bd-rust-preview")
            .ok_or("No experimental data directory available")?
            .data_local_dir()
            .to_path_buf(),
    };
    fs::create_dir_all(&directory)?;
    let lock = File::options()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("native.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Another native app is using this experimental profile")?;
    let fonts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("demo-covers");
    for name in ["DM-Sans.ttf", "Outfit.ttf"] {
        let file = fonts.join(name);
        if file.exists() {
            use slint::fontique_012::{fontique, shared_collection};
            shared_collection()
                .register_fonts(fontique::Blob::new(Arc::new(fs::read(file)?)), None);
        }
    }
    let ui = AppWindow::new()?;
    ui.global::<UiPalette>()
        .on_star_colour(visuals::star_colour);
    ui.global::<UiPalette>()
        .on_star_handle(visuals::star_handle);
    ui.global::<UiPalette>().on_star_ink(visuals::star_ink);
    ui.global::<UiPalette>().on_bpm_colour(visuals::bpm_colour);
    let _ = ui.window().set_rendering_notifier(|state, api| {
        if matches!(state, slint::RenderingState::RenderingSetup) {
            println!("Graphics renderer: {api:?}");
        }
    });
    ui.window().set_size(slint::LogicalSize::new(1440.0, 980.0));
    let mut store = Store::open(&directory)?;
    let recovery = store.take_recovery();
    let demo = args
        .iter()
        .any(|arg| ["--demo", "--smoke-test", "--stress", "--scroll-test"].contains(&arg.as_str()));
    let mut demo_sets = fixtures();
    if args
        .iter()
        .any(|arg| ["--stress", "--scroll-test"].contains(&arg.as_str()))
    {
        let original = demo_sets.clone();
        demo_sets = (0..10000)
            .map(|index| {
                let mut set = original[index % original.len()].clone();
                set.id = 10_000_000 + index as u64;
                set.title = format!("{} · {:05}", set.title, index + 1);
                set
            })
            .collect();
    }
    let (sender, receiver) = mpsc::channel();
    let mut state = State {
        store,
        profile: directory,
        recovery,
        selected: HashSet::new(),
        filters: Filters::default(),
        ranges: ranges(),
        covers: HashMap::new(),
        cover_order: VecDeque::new(),
        placeholders: (0..3)
            .map(|index| {
                let image = visuals::placeholder(index);
                (image.clone(), image)
            })
            .collect(),
        view_positions: HashMap::new(),
        client,
        sender,
        running: None,
        paused: false,
        busy: false,
        successful_loads: 0,
        demo,
        demo_sets,
        next_start: Instant::now(),
    };
    println!(
        "PACC-BD Rust experimental\nProfile: {}\nDownloads: {}",
        state.profile.display(),
        state.store.directory.display()
    );
    let initial: Vec<_> = state
        .groups(0)
        .iter()
        .chain(state.store.ids.iter())
        .cloned()
        .collect();
    for set in initial.iter().take(150) {
        let file = fonts.join(format!("{}.jpg", set.id));
        let pair = fs::read(file)
            .map_err(|e| e.to_string())
            .and_then(visuals::decode)
            .map(visuals::images);
        if let Ok(pair) = pair {
            state.insert_cover(set.id, pair);
        }
    }
    if !demo {
        start_covers(state.client.clone(), state.sender.clone(), initial);
    }
    ui.set_directory(state.store.directory.to_string_lossy().into_owned().into());
    ui.set_catboy(state.store.mirror == Mirror::Catboy);
    ui.set_light(state.store.light || args.iter().any(|arg| arg == "--light"));
    ui.set_spanish(state.store.spanish);
    ui.set_triangles(visuals::triangles());
    ui.set_ranges(ModelRc::new(VecModel::from(state.ranges.clone())));
    ui.set_source_open(state.demo || state.groups(0).is_empty());
    state.refresh(&ui);
    let data = Rc::new(RefCell::new(state));

    let state = data.clone();
    ui.on_open_download_folder(move || {
        let state = state.borrow();
        let directory = state.store.directory.clone();
        let sender = state.sender.clone();
        thread::spawn(move || {
            let result =
                desktop::open_download_folder(&directory).map_err(|error| error.to_string());
            let _ = sender.send(Event::FolderOpened(result));
        });
    });

    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_search_changed(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            state.ui_filters(&ui);
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_page_changed(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            state.selected.clear();
            ui.set_source_input("".into());
            ui.set_scroll_y(0.0);
            ui.set_source_open(state.demo || state.groups(ui.get_page()).is_empty());
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_advanced_toggled(move || {
        if let Some(ui) = weak.upgrade() {
            ui.set_ranges(ModelRc::new(VecModel::from(state.borrow().ranges.clone())));
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_theme_changed(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            state.store.light = ui.get_light();
            state.store.spanish = ui.get_spanish();
            if !state.demo {
                state.persist(&ui);
            }
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_range_edited(move |key, lower, upper| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            if let Some(range) = state.ranges.iter_mut().find(|range| range.key == key) {
                range.lower = lower;
                range.upper = upper;
                let limit = range.limit;
                state.filters.ranges[key as usize] = Range {
                    min: lower,
                    max: (upper < limit).then_some(upper),
                };
            }
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_toggle_map(move |id| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            if !state.selected.remove(&(id as u64)) {
                state.selected.insert(id as u64);
            }
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_clear_selection(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            state.selected.clear();
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_select_visible(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            state
                .selected
                .extend(ui.get_maps().iter().map(|map| map.id as u64));
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_enqueue_map(move |id| {
        if let Some(ui) = weak.upgrade() {
            state.borrow_mut().enqueue(&ui, vec![id as u64]);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_enqueue_selected(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            let ids = state.selected.iter().copied().collect();
            state.enqueue(&ui, ids);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_enqueue_all(move || {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            let ids = state
                .groups(ui.get_page())
                .iter()
                .map(|set| set.id)
                .collect();
            state.enqueue(&ui, ids);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_recovery_choice(move |recover| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            if recover {
                state.store.queue = std::mem::take(&mut state.recovery);
            } else {
                state.recovery.clear();
            }
            state.persist(&ui);
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_queue_action(move |action| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            match action.as_str() {
                "pause" => state.paused = !state.paused,
                "cancel" => {
                    if let Some(running) = &state.running { running.cancel.store(true, Ordering::Relaxed); }
                    for item in &mut state.store.queue {
                         if matches!(item.status,Status::Pending | Status::Downloading) { item.status = Status::Cancelled; }
                    }
                }
                "retry" => {
                    for item in &mut state.store.queue {
                        if item.status == Status::Failed {
                            item.status = Status::Pending;
                            item.error.clear(); item.bytes = 0; item.total = None;
                        }
                    }
                }
                "clear" => {
                    if state.running.is_none() && !state.store.queue.iter().any(|item| item.status == Status::Pending) {
                        state.store.queue.clear();
                    } else {
                        ui.set_notice("Cancel pending work and wait for the active transfer before clearing history".into());
                    }
                }
                _ => {}
            }
            state.persist(&ui);
            state.refresh(&ui);
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_settings_save(move |directory, catboy| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            let path = PathBuf::from(directory.as_str());
            if !path.is_absolute() || path.parent().is_none() {
                ui.set_notice("Choose an absolute download folder, not a filesystem root".into());
                return;
            }
            if let Err(error) = fs::create_dir_all(&path) {
                ui.set_notice(error.to_string().into());
                return;
            }
            state.store.directory = path;
            state.store.mirror = if catboy {
                Mirror::Catboy
            } else {
                Mirror::Direct
            };
            if state.persist(&ui) {
                ui.set_download_location(
                    state.store.directory.to_string_lossy().into_owned().into(),
                );
                ui.set_notice(
                    "Settings saved. Existing queue entries retain their original target folder."
                        .into(),
                );
            }
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_open_map(move |id| {
        if let Some(ui) = weak.upgrade() {
            let state = state.borrow();
            if !state.demo
                && state
                    .groups(ui.get_page())
                    .iter()
                    .any(|set| set.id == id as u64)
                && let Err(error) =
                    webbrowser::open(&format!("https://osu.ppy.sh/beatmapsets/{id}"))
            {
                ui.set_notice(error.to_string().into());
            }
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_inspect_map(move |id| {
        if let Some(ui) = weak.upgrade() {
            let state = state.borrow();
            if let Some(set) = state
                .groups(ui.get_page())
                .iter()
                .find(|set| set.id == id as u64)
            {
                let mut text = format!(
                    "{} — {}\nMapped by {} · {}\n\n",
                    set.artist, set.title, set.creator, set.status
                );
                for diff in &set.difficulties {
                    text.push_str(&format!(
                        "{} · {} · {}★\nBPM {} · AR {} · OD {} · CS {} · HP {} · {} seconds\n\n",
                        diff.version,
                        diff.mode,
                        stat(diff.stars),
                        stat(diff.bpm),
                        stat(diff.ar),
                        stat(diff.od),
                        stat(diff.cs),
                        stat(diff.hp),
                        stat(diff.length)
                    ));
                }
                text.push_str("Unmodded stats. Downloads contain the entire beatmapset.");
                ui.set_info_text(text.into());
            }
        }
    });
    let weak = ui.as_weak();
    let state = data.clone();
    ui.on_load_source(move |page, input, number_is_set| {
        if let Some(ui) = weak.upgrade() {
            let mut state = state.borrow_mut();
            if state.busy {
                return;
            }
            let parsed = if page == 0 {
                network::collection_id(&input).map(Some)
            } else {
                network::osu_inputs(&input, number_is_set).map(|_| None)
            };
            let parsed = match parsed {
                Ok(value) => value,
                Err(error) => {
                    ui.set_notice(error.into());
                    return;
                }
            };
            state.busy = true;
            state.refresh(&ui);
            ui.set_notice("Loading public metadata…".into());
            let client = state.client.clone();
            let sender = state.sender.clone();
            thread::spawn(move || {
                let result = if let Some(id) = parsed {
                    network::collector(&client, id).map(|(name, sets)| (name, sets, vec![]))
                } else {
                    network::osu_inputs(&input, number_is_set)
                        .and_then(|inputs| network::resolve(&client, inputs))
                        .map(|(sets, errors)| ("Resolved osu! IDs".into(), sets, errors))
                };
                let sets = result
                    .as_ref()
                    .ok()
                    .map(|(_, sets, _)| sets.clone())
                    .unwrap_or_default();
                let _ = sender.send(Event::Loaded(page, result));
                start_covers(client, sender, sets);
            });
        }
    });

    let weak = ui.as_weak();
    let state = data.clone();
    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(60),
        move || {
            if let Some(ui) = weak.upgrade() {
                let mut state = state.borrow_mut();
                let mut listing_changed = false;
                let mut queue_changed = false;
                let mut transfer_changed = false;
                for event in receiver.try_iter() {
                    match &event {
                        Event::Progress(..) => transfer_changed = true,
                        Event::Message(..) => queue_changed = true,
                        Event::Finished(..) => queue_changed = true,
                        Event::Cover(..) | Event::FolderOpened(..) => {}
                        _ => listing_changed = true,
                    }
                    handle_event(&mut state, &ui, event);
                }
                if listing_changed {
                    state.refresh(&ui);
                } else if queue_changed {
                    state.refresh_queue(&ui);
                } else if transfer_changed {
                    state.refresh_transfer(&ui);
                }
                ui.set_pulse((ui.get_pulse() + 0.035) % 1.0);
                state.drive(&ui);
            }
        },
    );
    let live_test = slint::Timer::default();
    let scroll_test = slint::Timer::default();
    if args.iter().any(|arg| arg == "--scroll-test") {
        if !data.borrow().recovery.is_empty() {
            return Err("Use a fresh profile for --scroll-test".into());
        }
        ui.set_more(true);
        let weak = ui.as_weak();
        let state = data.clone();
        let mut step = 0usize;
        let mut last = Instant::now();
        let mut samples = Vec::<f64>::new();
        scroll_test.start(slint::TimerMode::Repeated,Duration::from_millis(16),move||{
            if let Some(ui)=weak.upgrade(){
                if step>15 {samples.push(last.elapsed().as_secs_f64()*1000.0);}
                last=Instant::now();
                if step>5 {
                    assert_eq!(ui.get_maps().row_count(),10000);
                    let bound=((ui.get_viewport_height()/184.0).ceil() as i32+3)*ui.get_columns();
                    assert!(ui.get_rendered_card_count()>0 && ui.get_rendered_card_count()<=bound);
                    assert_eq!(state.borrow().placeholders.len(),3);
                }
                let maximum=(ui.get_document_height()-ui.get_viewport_height()).max(0.0);
                ui.set_scroll_y(-maximum*((step%121) as f32/120.0));
                step+=1;
                if step>=123 {
                    samples.sort_by(f64::total_cmp);
                    println!("Scroll stress passed: 10,000 maps; {} card trees; 3 shared placeholders. Event-loop tick p50 {:.1} ms / p95 {:.1} ms (not an FPS benchmark).",ui.get_rendered_card_count(),samples[samples.len()/2],samples[(samples.len()-1)*95/100]);
                    ui.hide().unwrap();slint::quit_event_loop().unwrap();
                }
            }
        });
    }
    if args.iter().any(|arg| arg == "--smoke-live") {
        if !data.borrow().recovery.is_empty() {
            return Err("Live UI test needs a profile with no pending queue".into());
        }
        ui.set_page(1);
        ui.invoke_load_source(1, "https://osu.ppy.sh/beatmapsets/63834".into(), true);
        let weak = ui.as_weak();
        let state = data.clone();
        let start = Instant::now();
        live_test.start(
            slint::TimerMode::Repeated,
            Duration::from_millis(100),
            move || {
                if let Some(ui) = weak.upgrade() {
                    let state = state.borrow();
                    if state.successful_loads > 0 && !state.busy {
                        assert_eq!(state.store.ids.len(), 1);
                        assert_eq!(state.store.ids[0].id, 63834);
                        assert_eq!(ui.get_maps().row_count(), 1);
                        assert_eq!(ui.get_queue_count(), 0);
                        ui.invoke_inspect_map(63834);
                        assert!(ui.get_info_text().contains("Unmodded stats"));
                        println!("Live metadata UI smoke test passed (no downloads started).");
                        ui.hide().unwrap();
                        slint::quit_event_loop().unwrap();
                    } else if start.elapsed() > Duration::from_secs(45) {
                        panic!("Live UI metadata test timed out: {}", ui.get_notice());
                    }
                }
            },
        );
    }
    if args.iter().any(|arg| arg == "--narrow") {
        ui.window().set_size(slint::LogicalSize::new(440.0, 900.0));
    }
    if args.iter().any(|arg| arg == "--advanced") {
        ui.set_more(true);
    }
    if let Some(index) = args.iter().position(|arg| arg == "--scroll-to") {
        let offset = args
            .get(index + 1)
            .ok_or("--scroll-to requires a pixel offset")?
            .parse::<f32>()?;
        let weak = ui.as_weak();
        slint::Timer::single_shot(Duration::from_millis(150), move || {
            if let Some(ui) = weak.upgrade() {
                ui.set_scroll_y(-offset.max(0.0));
            }
        });
    }
    if args.iter().any(|arg| arg == "--smoke-test") {
        let weak = ui.as_weak();
        slint::Timer::single_shot(Duration::from_millis(600), move || {
            if let Some(ui) = weak.upgrade() {
                assert_eq!(ui.get_maps().row_count(), 6);
                ui.set_search("Blue Zenith".into());
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_count(), 1);
                ui.set_search("".into());
                ui.set_star_min(6.0);
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_count(), 2);
                ui.set_star_min(0.0);
                ui.invoke_search_changed();
                ui.invoke_select_visible();
                assert_eq!(ui.get_selected_count(), 6);
                ui.invoke_toggle_map(63834);
                assert_eq!(ui.get_selected_count(), 5);
                ui.invoke_clear_selection();
                assert_eq!(ui.get_selected_count(), 0);
                ui.invoke_range_edited(1, 400.0, 400.0);
                assert_eq!(ui.get_maps().row_count(), 0);
                ui.set_include_unknown(true);
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_count(), 6);
                ui.set_include_unknown(false);
                ui.invoke_range_edited(1, 0.0, 400.0);
                ui.invoke_search_changed();
                ui.set_mode_index(4);
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_count(), 0);
                ui.set_mode_index(0);
                ui.set_status_index(4);
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_count(), 0);
                ui.set_status_index(0);
                ui.set_sort_index(1);
                ui.invoke_search_changed();
                assert_eq!(ui.get_maps().row_data(0).unwrap().title, "Blue Zenith");
                ui.invoke_enqueue_map(63834);
                assert_eq!(ui.get_queue_count(), 0, "fixtures must never download");
                ui.set_list_view(true);
                assert_eq!(ui.get_columns(), 1);
                println!("Native functional UI smoke test passed.");
                ui.hide().unwrap();
                slint::quit_event_loop().unwrap();
            }
        });
    }
    let capture_error: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    if let Some(index) = args.iter().position(|arg| arg == "--screenshot") {
        let file = PathBuf::from(
            args.get(index + 1)
                .ok_or("--screenshot requires a PNG path")?,
        );
        let weak = ui.as_weak();
        let failure = capture_error.clone();
        slint::Timer::single_shot(Duration::from_millis(400), move || {
            if let Some(ui) = weak.upgrade() {
                let result = (|| -> Result<(), String> {
                    // Slint's software snapshot buffer can lag a fractional-DPI
                    // resize on Wayland. Avoid its too-small-buffer assertion.
                    let size = ui.window().size();
                    let scale = ui.window().scale_factor();
                    if (ui.get_canvas_width() * scale).ceil() as u32 > size.width
                        || (ui.get_canvas_height() * scale).ceil() as u32 > size.height
                    {
                        return Err("Capture surface is being rescaled. For deterministic captures, launch with SLINT_SCALE_FACTOR=1.".into());
                    }
                    let pixels = ui
                        .window()
                        .take_snapshot()
                        .map_err(|error| error.to_string())?;
                    image::save_buffer(
                        &file,
                        pixels.as_bytes(),
                        pixels.width(),
                        pixels.height(),
                        image::ColorType::Rgba8,
                    )
                    .map_err(|error| error.to_string())?;
                    Ok(())
                })();
                if let Err(error) = result {
                    *failure.borrow_mut() = Some(error);
                } else {
                    println!("Saved {}", file.display());
                }
                ui.hide().unwrap();
                slint::quit_event_loop().unwrap();
            }
        });
    }
    ui.run()?;
    timer.stop();
    scroll_test.stop();
    live_test.stop();
    let mut state = data.borrow_mut();
    if let Some(running) = state.running.take() {
        running.cancel.store(true, Ordering::Relaxed);
        // The archive may have committed just before the close request. Reconcile
        // that result even when its UI event was never processed. An interrupted
        // transfer remains recoverable rather than becoming explicitly cancelled.
        if let Ok(result) = running.thread.join()
            && let Some(item) = state
                .store
                .queue
                .iter_mut()
                .find(|item| item.id == running.id)
            && let Ok(file) = result
        {
            item.status = Status::Done;
            item.file = Some(file);
            item.error.clear();
        }
    }
    if !state.demo {
        state.persist(&ui);
    } // interrupted active jobs remain recoverable, not cancelled
    if let Some(error) = capture_error.borrow_mut().take() {
        return Err(error.into());
    }
    Ok(())
}

fn stat(value: Option<f32>) -> String {
    value
        .map(|v| format!("{v:.2}"))
        .unwrap_or_else(|| "Unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelling_a_job_keeps_it_locked_until_its_worker_exits() {
        let queue = vec![Download {
            id: 42,
            title: "Song".into(),
            status: Status::Cancelled,
            error: String::new(),
            file: None,
            directory: None,
            bytes: 0,
            total: None,
        }];
        assert!(locked_downloads(&queue, Some(42)).contains(&42));
        assert!(!locked_downloads(&queue, None).contains(&42));
    }
    #[test]
    fn loading_artwork_updates_only_one_row_without_replacing_the_model() {
        let model = ModelRc::new(VecModel::from(vec![
            MapCard {
                id: 42,
                title: "Selected song".into(),
                selected: true,
                ..Default::default()
            },
            MapCard {
                id: 43,
                title: "Unchanged song".into(),
                ..Default::default()
            },
        ]));
        let clone = model.clone();
        let image =
            slint::Image::from_rgba8(slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(3, 2));
        assert!(update_cover_row(&model, 0, &(image.clone(), image)));
        assert_eq!(clone.row_count(), 2);
        assert_eq!(clone.row_data(0).unwrap().cover.size().width, 3);
        assert!(clone.row_data(0).unwrap().selected);
        assert_eq!(clone.row_data(1).unwrap().title, "Unchanged song");
        assert_eq!(clone.row_data(1).unwrap().cover.size().width, 0);
        assert!(!update_cover_row(&model, 9, &Default::default()));
    }
}
