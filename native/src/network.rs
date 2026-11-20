use crate::model::{BeatmapSet, Difficulty, Mirror};
use reqwest::{
    Url,
    blocking::{Client, Response},
    redirect::Policy,
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::OnceLock,
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;

pub fn client() -> Result<Client> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!(
            "PACC-BD/",
            env!("CARGO_PKG_VERSION"),
            " (public beatmap downloader)"
        ))
        .build()
        .map_err(|error| error.to_string())
}

pub fn trusted_url(url: &Url, hosts: &[&str]) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && hosts.contains(&url.host_str().unwrap_or_default())
}

pub fn request(client: &Client, mut url: Url, hosts: &[&str]) -> Result<Response> {
    for _ in 0..4 {
        if !trusted_url(&url, hosts) {
            return Err("Blocked redirect to an unapproved host".into());
        }
        let response = client
            .get(url.clone())
            .send()
            .map_err(|error| error.to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or("Invalid redirect")?;
            url = url.join(location).map_err(|error| error.to_string())?;
        } else {
            return Ok(response);
        }
    }
    Err("Too many redirects".into())
}

fn bounded(response: Response, max: usize) -> Result<Vec<u8>> {
    if !response.status().is_success() {
        return Err(format!(
            "Metadata service returned HTTP {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > max as u64)
    {
        return Err("Metadata response is too large".into());
    }
    let mut data = Vec::new();
    response
        .take(max as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| error.to_string())?;
    if data.len() > max {
        return Err("Metadata response is too large".into());
    }
    Ok(data)
}

fn json(client: &Client, url: &str) -> Result<Value> {
    let response = request(
        client,
        Url::parse(url).map_err(|error| error.to_string())?,
        &["osucollector.com", "www.osucollector.com"],
    )?;
    serde_json::from_slice(&bounded(response, 8 * 1024 * 1024)?).map_err(|error| error.to_string())
}

fn valid_id(value: &str) -> Result<u64> {
    if value.is_empty() || value.len() > 13 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Invalid numeric ID".into());
    }
    let id = value.parse::<u64>().map_err(|_| "Invalid ID")?;
    if id == 0 || id > i32::MAX as u64 {
        return Err("ID is outside the supported positive range".into());
    }
    Ok(id)
}

pub fn collection_id(input: &str) -> Result<u64> {
    let input = input.trim();
    if let Ok(id) = valid_id(input) {
        return Ok(id);
    }
    let url = Url::parse(input).map_err(|_| "Enter a Collector ID or collection URL")?;
    if !trusted_url(&url, &["osucollector.com", "www.osucollector.com"]) {
        return Err("Only HTTPS osucollector.com collection URLs are supported".into());
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if parts.first() != Some(&"collections") || !(2..=3).contains(&parts.len()) {
        return Err("Expected /collections/{id}".into());
    }
    valid_id(parts[1])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OsuId {
    pub id: u64,
    pub set: bool,
}

pub fn osu_inputs(input: &str, number_is_set: bool) -> Result<Vec<OsuId>> {
    if input.len() > 30000 {
        return Err("Enter up to 200 IDs".into());
    }
    let tokens: Vec<_> = input
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|s| !s.is_empty())
        .collect();
    if tokens.is_empty() || tokens.len() > 200 {
        return Err("Enter 1–200 osu! IDs or links".into());
    }
    let mut result = vec![];
    for token in tokens {
        let item = if let Ok(id) = valid_id(token) {
            OsuId {
                id,
                set: number_is_set,
            }
        } else {
            let url = Url::parse(token).map_err(|_| "Invalid osu! link")?;
            if !trusted_url(&url, &["osu.ppy.sh"]) {
                return Err("Only HTTPS osu.ppy.sh beatmap links are supported".into());
            }
            let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
            if parts.len() != 2 || !["beatmaps", "beatmapsets"].contains(&parts[0]) {
                return Err("Expected a beatmap or beatmapset link".into());
            }
            let mut item = OsuId {
                id: valid_id(parts[1])?,
                set: parts[0] == "beatmapsets",
            };
            if let Some(fragment) = url.fragment() {
                let pair: Vec<_> = fragment.split('/').collect();
                if !item.set
                    || pair.len() != 2
                    || !["osu", "taiko", "fruits", "mania"].contains(&pair[0])
                {
                    return Err("Unknown difficulty fragment".into());
                }
                item = OsuId {
                    id: valid_id(pair[1])?,
                    set: false,
                };
            }
            item
        };
        if !result.contains(&item) {
            result.push(item);
        }
    }
    Ok(result)
}

fn text(value: &Value, key: &str, fallback: &str) -> String {
    value[key].as_str().unwrap_or(fallback).to_owned()
}
fn stat(value: &Value, key: &str) -> Option<f32> {
    value[key]
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= f32::MAX as f64)
        .map(|v| v as f32)
}
pub fn difficulty(raw: &Value) -> Option<Difficulty> {
    let id = raw["id"]
        .as_u64()
        .filter(|id| *id > 0 && *id <= i32::MAX as u64)?;
    let mode = raw["mode"].as_str().map(str::to_owned).unwrap_or_else(|| {
        ["osu", "taiko", "fruits", "mania"]
            .get(
                raw["mode_int"]
                    .as_u64()
                    .or_else(|| raw["mode"].as_u64())
                    .unwrap_or(0) as usize,
            )
            .unwrap_or(&"osu")
            .to_string()
    });
    Some(Difficulty {
        id,
        checksum: raw["checksum"]
            .as_str()
            .filter(|value| value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .map(str::to_owned),
        version: text(raw, "version", "Unknown difficulty"),
        mode,
        stars: stat(raw, "difficulty_rating"),
        bpm: stat(raw, "bpm"),
        ar: stat(raw, "ar"),
        od: stat(raw, "accuracy").or_else(|| stat(raw, "od")),
        cs: stat(raw, "cs"),
        hp: stat(raw, "drain").or_else(|| stat(raw, "hp")),
        length: stat(raw, "hit_length"),
        converted: raw["convert"].as_bool().unwrap_or(false),
    })
}
fn set_metadata(raw: &Value, id: u64) -> BeatmapSet {
    BeatmapSet {
        id,
        title: text(raw, "title", "Unknown title"),
        artist: text(raw, "artist", "Unknown artist"),
        creator: text(raw, "creator", "Unknown mapper"),
        status: text(raw, "status", "unknown"),
        featured_artist: raw["track_id"].as_u64().is_some_and(|id| id > 0),
        difficulties: vec![],
    }
}

pub fn collector(client: &Client, id: u64) -> Result<(String, Vec<BeatmapSet>)> {
    let info = json(
        client,
        &format!("https://osucollector.com/api/collections/{id}"),
    )?;
    if info["id"].as_u64() != Some(id) {
        return Err("Collection not found or private".into());
    }
    let mut sets = vec![];
    let mut by_set = HashMap::<u64, usize>::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    for _ in 0..1000 {
        let mut url = Url::parse(&format!(
            "https://osucollector.com/api/collections/{id}/beatmapsV2"
        ))
        .unwrap();
        url.query_pairs_mut().append_pair("perPage", "100");
        if let Some(cursor) = &cursor {
            url.query_pairs_mut().append_pair("cursor", cursor);
        }
        let page = json(client, url.as_str())?;
        for raw in page["beatmaps"]
            .as_array()
            .ok_or("Unexpected Collector page")?
        {
            let Some(mut diff) = difficulty(raw) else {
                continue;
            };
            if !seen.insert(diff.id) {
                continue;
            }
            let metadata = &raw["beatmapset"];
            let Some(set_id) = raw["beatmapset_id"]
                .as_u64()
                .or_else(|| metadata["id"].as_u64())
                .filter(|id| *id > 0 && *id <= i32::MAX as u64)
            else {
                continue;
            };
            diff.bpm = diff.bpm.or_else(|| stat(metadata, "bpm"));
            let index = *by_set.entry(set_id).or_insert_with(|| {
                sets.push(set_metadata(metadata, set_id));
                sets.len() - 1
            });
            sets[index].difficulties.push(diff);
        }
        if !page["hasMore"]
            .as_bool()
            .ok_or("Missing pagination status; preview incomplete")?
        {
            return Ok((text(&info, "name", "Collector collection"), sets));
        }
        let next = match &page["nextPageCursor"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => return Err("Missing pagination cursor; preview incomplete".into()),
        };
        if next.is_empty() || !cursors.insert(next.clone()) {
            return Err("Repeated pagination cursor; preview incomplete".into());
        }
        cursor = Some(next);
    }
    Err("Too many Collector pages".into())
}

pub fn parse_osu_page(html: &str, requested: OsuId) -> Result<BeatmapSet> {
    static SCRIPT: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = SCRIPT.get_or_init(|| {
        regex::Regex::new(r#"(?is)<script\b[^>]*\bid=["']json-beatmapset["'][^>]*>(.*?)</script>"#)
            .unwrap()
    });
    let json = pattern
        .captures(html)
        .and_then(|cap| cap.get(1))
        .ok_or("osu! did not provide public beatmap metadata")?;
    let raw: Value = serde_json::from_str(json.as_str()).map_err(|error| error.to_string())?;
    let id = raw["id"]
        .as_u64()
        .filter(|id| *id > 0 && *id <= i32::MAX as u64)
        .ok_or("Invalid beatmapset ID")?;
    if requested.set && id != requested.id {
        return Err("osu! returned another beatmapset".into());
    }
    let mut set = set_metadata(&raw, id);
    set.difficulties = raw["beatmaps"]
        .as_array()
        .ok_or("Missing difficulties")?
        .iter()
        .filter_map(difficulty)
        .collect();
    for diff in &mut set.difficulties {
        diff.bpm = diff.bpm.or_else(|| stat(&raw, "bpm"));
    }
    if !requested.set {
        set.difficulties.retain(|diff| diff.id == requested.id);
        if set.difficulties.is_empty() {
            return Err("Requested difficulty is unavailable".into());
        }
    }
    Ok(set)
}

pub fn resolve(client: &Client, inputs: Vec<OsuId>) -> Result<(Vec<BeatmapSet>, Vec<String>)> {
    let mut sets: Vec<BeatmapSet> = vec![];
    let mut failures = vec![];
    for (index, item) in inputs.into_iter().enumerate() {
        if index > 0 {
            std::thread::sleep(Duration::from_millis(650));
        }
        let result = (|| {
            let url = Url::parse(&format!(
                "https://osu.ppy.sh/{}/{}",
                if item.set { "beatmapsets" } else { "beatmaps" },
                item.id
            ))
            .unwrap();
            let data = bounded(request(client, url, &["osu.ppy.sh"])?, 4 * 1024 * 1024)?;
            parse_osu_page(&String::from_utf8_lossy(&data), item)
        })();
        match result {
            Ok(mut set) => {
                if let Some(old) = sets.iter_mut().find(|old| old.id == set.id) {
                    for diff in set.difficulties.drain(..) {
                        if !old.difficulties.iter().any(|old| old.id == diff.id) {
                            old.difficulties.push(diff);
                        }
                    }
                } else {
                    sets.push(set);
                }
            }
            Err(error) => {
                let rate_limit = error.contains("429");
                failures.push(format!("{}: {error}", item.id));
                if rate_limit {
                    failures.push("Remaining IDs skipped due to rate limiting; try later".into());
                    break;
                }
            }
        }
    }
    Ok((sets, failures))
}

pub fn mirror_url(mirror: Mirror, id: u64) -> (Url, &'static [&'static str]) {
    match mirror {
        Mirror::Direct => (
            Url::parse(&format!("https://osu.direct/api/d/{id}")).unwrap(),
            &["osu.direct", "storage.osu.direct"],
        ),
        Mirror::Catboy => (
            Url::parse(&format!("https://catboy.best/d/{id}")).unwrap(),
            &["catboy.best"],
        ),
    }
}

pub fn cover(client: &Client, id: u64) -> Result<Vec<u8>> {
    let url = Url::parse(&format!(
        "https://assets.ppy.sh/beatmaps/{id}/covers/cover.jpg"
    ))
    .unwrap();
    bounded(request(client, url, &["assets.ppy.sh"])?, 5 * 1024 * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extreme_stats_do_not_become_infinite_ui_values() {
        assert_eq!(stat(&serde_json::json!({"bpm": 1e300}), "bpm"), None);
        assert!(difficulty(&serde_json::json!({"id": 4294967296u64})).is_none());
    }

    #[test]
    fn rejects_untrusted_urls_and_normalizes_osu_inputs() {
        assert_eq!(
            collection_id("https://osucollector.com/collections/42/name").unwrap(),
            42
        );
        assert!(collection_id("https://osucollector.com.evil/collections/42").is_err());
        assert!(collection_id("https://user@osucollector.com/collections/42").is_err());
        assert_eq!(
            osu_inputs("42,42;https://osu.ppy.sh/beatmapsets/7#osu/9", true).unwrap(),
            vec![OsuId { id: 42, set: true }, OsuId { id: 9, set: false }]
        );
        assert!(osu_inputs("https://evil.com/beatmaps/1", false).is_err());
        assert!(osu_inputs("https://osu.ppy.sh/beatmapsets/1#bad", false).is_err());
        assert!(!trusted_url(
            &Url::parse("http://osu.direct/a").unwrap(),
            &["osu.direct"]
        ));
    }
    #[test]
    fn parses_metadata_and_preserves_missing_stats() {
        let html = r#"<script id='json-beatmapset'>{"id":7,"title":"Song","beatmaps":[{"id":9,"version":"Hard","difficulty_rating":4.2,"bpm":180}]}</script>"#;
        let set = parse_osu_page(html, OsuId { id: 9, set: false }).unwrap();
        assert_eq!(set.id, 7);
        assert_eq!(set.difficulties.len(), 1);
        assert_eq!(set.difficulties[0].ar, None);
        assert!(parse_osu_page(html, OsuId { id: 8, set: true }).is_err());
        assert!(parse_osu_page(html, OsuId { id: 10, set: false }).is_err());
    }
}
