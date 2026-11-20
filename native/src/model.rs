use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Difficulty {
    pub id: u64,
    pub version: String,
    #[serde(default)]
    pub checksum: Option<String>,
    pub mode: String,
    pub stars: Option<f32>,
    pub bpm: Option<f32>,
    pub ar: Option<f32>,
    pub od: Option<f32>,
    pub cs: Option<f32>,
    pub hp: Option<f32>,
    pub length: Option<f32>,
    pub converted: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BeatmapSet {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub creator: String,
    pub status: String,
    pub featured_artist: bool,
    pub difficulties: Vec<Difficulty>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mirror {
    #[default]
    Direct,
    Catboy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status {
    Pending,
    Downloading,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub id: u64,
    pub title: String,
    pub status: Status,
    pub error: String,
    pub file: Option<PathBuf>,
    #[serde(default)]
    pub directory: Option<PathBuf>,
    #[serde(skip)]
    pub bytes: u64,
    #[serde(skip)]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Store {
    pub version: u32,
    pub directory: PathBuf,
    pub mirror: Mirror,
    pub light: bool,
    pub spanish: bool,
    pub collector: Vec<BeatmapSet>,
    pub ids: Vec<BeatmapSet>,
    pub collection_name: String,
    pub queue: Vec<Download>,
}

pub fn atomic_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing parent directory"))?;
    fs::create_dir_all(directory)?;
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

impl Store {
    pub fn open(profile: &Path) -> io::Result<Self> {
        let file = profile.join("native-state.json");
        let value: Self = match fs::read(file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Self {
                version: 1,
                directory: profile.join("downloads"),
                mirror: Mirror::Direct,
                light: false,
                spanish: false,
                collector: vec![],
                ids: vec![],
                collection_name: "No collection loaded".into(),
                queue: vec![],
            },
            Err(error) => return Err(error),
        };
        if value.version != 1 {
            return Err(io::Error::other("Unsupported native state version"));
        }
        Ok(value)
    }
    pub fn save(&self, profile: &Path) -> io::Result<()> {
        atomic_json(&profile.join("native-state.json"), self)
    }
    /// Startup gate. All visible history is emptied, only unfinished entries may
    /// be explicitly recovered. No files are removed and no transfers are started.
    pub fn take_recovery(&mut self) -> Vec<Download> {
        let mut seen = HashSet::new();
        std::mem::take(&mut self.queue)
            .into_iter()
            .filter(|item| {
                matches!(
                    item.status,
                    Status::Pending | Status::Downloading | Status::Failed
                ) && seen.insert(item.id)
            })
            .map(|mut item| {
                item.status = Status::Pending;
                item.bytes = 0;
                item.total = None;
                item.error.clear();
                item
            })
            .collect()
    }
    pub fn enqueue(&mut self, set: &BeatmapSet) -> bool {
        if self
            .queue
            .iter()
            .any(|item| item.id == set.id && item.status != Status::Cancelled)
        {
            return false;
        }
        self.queue.retain(|item| item.id != set.id);
        self.queue.push(Download {
            id: set.id,
            title: set.title.clone(),
            status: Status::Pending,
            error: String::new(),
            file: None,
            directory: Some(self.directory.clone()),
            bytes: 0,
            total: None,
        });
        true
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Range {
    pub min: f32,
    pub max: Option<f32>,
}
impl Range {
    pub fn matches(self, value: Option<f32>, unknown: bool) -> bool {
        if self.min == 0.0 && self.max.is_none() {
            return true;
        }
        value
            .map(|value| value >= self.min && self.max.is_none_or(|max| value <= max))
            .unwrap_or(unknown)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Filters {
    pub ranges: [Range; 7], // stars, bpm, AR, OD, CS, HP, drain seconds
    pub mode: String,
    pub status: String,
    pub exclude_converted: bool,
    pub featured: bool,
    pub unknown: bool,
}
impl Filters {
    pub fn matches(&self, set: &BeatmapSet, query: &str) -> bool {
        !self.matching_difficulties(set, query).is_empty()
    }
    pub fn matching_difficulties<'a>(
        &self,
        set: &'a BeatmapSet,
        query: &str,
    ) -> Vec<&'a Difficulty> {
        if (!self.status.is_empty() && self.status != set.status)
            || (self.featured && !set.featured_artist)
        {
            return vec![];
        }
        let query = query.to_lowercase();
        set.difficulties
            .iter()
            .filter(|diff| {
                let text = format!(
                    "{} {} {} {} {}",
                    set.id, set.artist, set.title, set.creator, diff.version
                )
                .to_lowercase();
                text.contains(&query)
                    && (self.mode.is_empty() || self.mode == diff.mode)
                    && (!self.exclude_converted || !diff.converted)
                    && self
                        .ranges
                        .iter()
                        .zip([
                            diff.stars,
                            diff.bpm,
                            diff.ar,
                            diff.od,
                            diff.cs,
                            diff.hp,
                            diff.length,
                        ])
                        .all(|(range, value)| range.matches(value, self.unknown))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn combined_ranges_must_match_one_unmodded_difficulty() {
        let set = BeatmapSet {
            difficulties: vec![
                Difficulty {
                    stars: Some(3.0),
                    bpm: Some(220.0),
                    ..Default::default()
                },
                Difficulty {
                    stars: Some(7.0),
                    bpm: Some(120.0),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let mut filters = Filters::default();
        filters.ranges[0].min = 6.0;
        filters.ranges[1].min = 200.0;
        assert!(!filters.matches(&set, ""));
        filters.ranges[1].min = 0.0;
        assert!(filters.matches(&set, ""));
        filters.ranges[2].min = 8.0;
        assert!(!filters.matches(&set, ""));
        filters.unknown = true;
        assert!(filters.matches(&set, ""));
    }
    #[test]
    fn recovery_excludes_completed_and_cancelled_and_preserves_fifo() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = Store::open(dir.path()).unwrap();
        for id in 1..=5 {
            state.enqueue(&BeatmapSet {
                id,
                title: format!("Map {id}"),
                ..Default::default()
            });
        }
        state.queue[0].status = Status::Done;
        state.queue[1].status = Status::Downloading;
        state.queue[3].status = Status::Failed;
        state.queue[4].status = Status::Cancelled;
        state.save(dir.path()).unwrap();
        let mut loaded = Store::open(dir.path()).unwrap();
        let candidates = loaded.take_recovery();
        assert!(loaded.queue.is_empty());
        assert_eq!(
            candidates.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert!(candidates.iter().all(|item| item.status == Status::Pending));
        // An unanswered prompt remains recoverable if the app is closed.
        let mut snapshot = loaded.clone();
        snapshot.queue = candidates;
        snapshot.save(dir.path()).unwrap();
        assert_eq!(Store::open(dir.path()).unwrap().take_recovery().len(), 3);
    }
    #[test]
    fn rejects_corrupt_and_future_native_profiles_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("native-state.json");
        fs::write(&file, b"broken JSON").unwrap();
        assert!(Store::open(dir.path()).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"broken JSON");
        fs::remove_file(&file).unwrap();
        let mut state = Store::open(dir.path()).unwrap();
        state.version = 999;
        state.save(dir.path()).unwrap();
        assert!(Store::open(dir.path()).is_err());
    }
    #[test]
    fn persisted_queue_starts_empty_until_recovery_and_keeps_target_folder() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = Store::open(dir.path()).unwrap();
        let set = BeatmapSet {
            id: 42,
            title: "Map".into(),
            ..Default::default()
        };
        assert!(state.enqueue(&set));
        assert!(!state.enqueue(&set));
        state.queue[0].status = Status::Downloading;
        let target = state.directory.clone();
        state.save(dir.path()).unwrap();
        let mut loaded = Store::open(dir.path()).unwrap();
        let recovery = loaded.take_recovery();
        assert!(loaded.queue.is_empty());
        assert_eq!(recovery.len(), 1);
        assert_eq!(recovery[0].directory.as_ref(), Some(&target));
        assert_eq!(recovery[0].status, Status::Pending);
        loaded.save(dir.path()).unwrap();
        assert!(Store::open(dir.path()).unwrap().take_recovery().is_empty());
    }
}
