use crate::{
    model::Mirror,
    network::{self, Result},
};
use reqwest::blocking::Client;
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub const MAX_ARCHIVE: u64 = 1024 * 1024 * 1024;

pub fn valid_osz(path: &Path) -> Result<()> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|_| "Response is not a valid .osz ZIP archive")?;
    if zip.len() > 50000 {
        return Err("Archive contains too many entries".into());
    }
    let mut scanned = 0;
    let mut has_osu = false;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        if entry.enclosed_name().is_none() {
            return Err("Unsafe archive entry path".into());
        }
        if !has_osu && entry.name().to_ascii_lowercase().ends_with(".osu") && !entry.is_dir() {
            if entry.size() > 16 * 1024 * 1024 {
                return Err("Oversized .osu entry".into());
            }
            scanned += entry.size();
            if scanned > 64 * 1024 * 1024 {
                return Err("Archive validation budget exceeded".into());
            }
            let mut bytes = Vec::new();
            entry
                .by_ref()
                .take(16 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            let text = String::from_utf8_lossy(&bytes);
            if text
                .trim_start_matches('\u{feff}')
                .trim_start()
                .starts_with("osu file format")
            {
                has_osu = true;
            }
        }
    }
    if has_osu {
        Ok(())
    } else {
        Err("Archive has no valid .osu difficulty".into())
    }
}

/// Streams only to our own create-new temporary file. Atomic no-clobber commit;
/// never extracts entries or imports anything into osu!.
pub fn save_stream(
    mut reader: impl Read,
    total: Option<u64>,
    directory: &Path,
    id: u64,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<PathBuf> {
    if !directory.is_absolute() || directory.parent().is_none() {
        return Err("Choose an absolute download folder, not a filesystem root".into());
    }
    if total.is_some_and(|size| size > MAX_ARCHIVE) {
        return Err("Archive exceeds the 1 GiB safety limit".into());
    }
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut file = tempfile::Builder::new()
        .prefix(".pacc-native-")
        .suffix(".part")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    let mut bytes = 0;
    let mut buffer = [0; 65536];
    let mut last = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let result = reader.read(&mut buffer);
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let count = result.map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > MAX_ARCHIVE {
            return Err("Archive exceeds the 1 GiB safety limit".into());
        }
        file.write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        if last.elapsed() >= Duration::from_millis(100) {
            progress(bytes, total);
            last = Instant::now();
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    if total.is_some_and(|size| size != bytes) {
        return Err("Incomplete download: file size differs from Content-Length".into());
    }
    file.flush().map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    valid_osz(file.path())?;
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    let target = directory.join(format!("{id}.osz"));
    file.persist_noclobber(&target).map_err(|error| {
        format!(
            "Cannot commit archive without overwriting a file: {}",
            error.error
        )
    })?;
    progress(bytes, total);
    Ok(target)
}

fn wait(duration: Duration, cancel: &AtomicBool) -> Result<()> {
    let start = Instant::now();
    while start.elapsed() < duration {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

pub fn run(
    client: &Client,
    mirror: Mirror,
    id: u64,
    directory: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, Option<u64>),
    mut message: impl FnMut(String),
) -> Result<PathBuf> {
    for attempt in 0..3 {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let (url, hosts) = network::mirror_url(mirror, id);
        let response = network::request(client, url, hosts);
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        match response {
            Ok(response) if response.status().is_success() => {
                let total = response.content_length().filter(|size| *size > 0);
                // Streaming failures are retried manually: no hidden retries can
                // overwrite files or multiply large transfers.
                return save_stream(response, total, directory, id, cancel, &mut progress);
            }
            Ok(response) => {
                let code = response.status().as_u16();
                let retry = code == 429 || code == 408 || code >= 500;
                if !retry || attempt == 2 {
                    return Err(format!("Mirror returned HTTP {code}"));
                }
                let header = response
                    .headers()
                    .get("retry-after")
                    .and_then(|s| s.to_str().ok());
                let seconds = if code == 429 {
                    match header {
                        Some(value) => value.parse::<u64>().map_err(
                            |_| "Rate limited; Retry-After requires a later manual retry",
                        )?,
                        None => 60,
                    }
                } else {
                    2 * (attempt + 1)
                };
                if seconds > 60 {
                    return Err("Mirror asks for a longer wait; retry manually later".into());
                }
                message(format!("HTTP {code} · retrying in {seconds}s"));
                wait(Duration::from_secs(seconds), cancel)?;
            }
            Err(error) => {
                if attempt == 2 || error.contains("Blocked") || error.contains("redirect") {
                    return Err(error);
                }
                message(format!("Network error · retry {} / 3", attempt + 2));
                wait(Duration::from_secs(2), cancel)?;
            }
        }
    }
    Err("Download attempts exhausted".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn archive() -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer
            .start_file("map.osu", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer
            .write_all(b"osu file format v14\n[Metadata]\nTitle:Test\n")
            .unwrap();
        writer.finish().unwrap().into_inner()
    }
    #[test]
    fn unsafe_entries_after_a_valid_map_are_rejected_without_extraction() {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer
            .start_file("map.osu", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"osu file format v14\n").unwrap();
        writer
            .start_file("../outside.osu", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"osu file format v14\n").unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let dir = tempfile::tempdir().unwrap();
        assert!(
            save_stream(
                &bytes[..],
                None,
                dir.path(),
                1,
                &AtomicBool::new(false),
                |_, _| {}
            )
            .unwrap_err()
            .contains("Unsafe")
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn streamed_http_without_length_stays_indeterminate() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let data = archive();
        let expected = data.clone();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0 && request.len() < 16384);
                request.extend_from_slice(&buffer[..count]);
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nConnection: close\r\n\r\n").unwrap();
            socket.write_all(&data).unwrap();
        });
        // Loopback exists only in this test; production URLs go through the
        // strict allowlist and never accept arbitrary URLs from the interface.
        let response = network::client()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .unwrap();
        assert_eq!(response.content_length(), None);
        let dir = tempfile::tempdir().unwrap();
        let mut progress = vec![];
        let file = save_stream(
            response,
            None,
            dir.path(),
            99,
            &AtomicBool::new(false),
            |bytes, total| progress.push((bytes, total)),
        )
        .unwrap();
        assert_eq!(std::fs::read(file).unwrap(), expected);
        assert_eq!(progress.last(), Some(&(expected.len() as u64, None)));
        server.join().unwrap();
    }
    #[test]
    fn cancellation_midstream_only_removes_our_own_temporary_file() {
        struct CancelReader<'a> {
            data: std::io::Cursor<Vec<u8>>,
            cancel: &'a AtomicBool,
        }
        impl Read for CancelReader<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let count = self.data.read(buffer)?;
                self.cancel.store(true, Ordering::Relaxed);
                Ok(count)
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        std::fs::write(dir.path().join("unrelated.part"), b"keep").unwrap();
        let reader = CancelReader {
            data: std::io::Cursor::new(archive()),
            cancel: &cancel,
        };
        assert_eq!(
            save_stream(reader, None, dir.path(), 99, &cancel, |_, _| {}).unwrap_err(),
            "Cancelled"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(
            std::fs::read(dir.path().join("unrelated.part")).unwrap(),
            b"keep"
        );
    }
    #[test]
    #[ignore = "opt-in live network check; downloads one set into an automatically removed temporary directory"]
    fn live_mirror_download() {
        let directory = tempfile::tempdir().unwrap();
        let client = network::client().unwrap();
        let file = run(
            &client,
            Mirror::Direct,
            63834,
            directory.path(),
            &AtomicBool::new(false),
            |_, _| {},
            |message| println!("{message}"),
        )
        .unwrap();
        valid_osz(&file).unwrap();
        println!(
            "Live mirror .osz verified ({} bytes)",
            std::fs::metadata(file).unwrap().len()
        );
    }
    #[test]
    fn downloads_validates_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let data = archive();
        let cancel = AtomicBool::new(false);
        let target = save_stream(
            &data[..],
            Some(data.len() as u64),
            dir.path(),
            42,
            &cancel,
            |_, _| {},
        )
        .unwrap();
        valid_osz(&target).unwrap();
        assert!(save_stream(&data[..], None, dir.path(), 42, &cancel, |_, _| {}).is_err());
        assert_eq!(std::fs::read(target).unwrap(), data);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn cancel_invalid_response_and_truncation_leave_no_partials() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(true);
        let data = archive();
        assert!(save_stream(&data[..], None, dir.path(), 1, &cancel, |_, _| {}).is_err());
        cancel.store(false, Ordering::Relaxed);
        assert!(
            save_stream(
                &b"<html>denied</html>"[..],
                None,
                dir.path(),
                1,
                &cancel,
                |_, _| {}
            )
            .is_err()
        );
        assert!(
            save_stream(
                &data[..],
                Some(data.len() as u64 + 1),
                dir.path(),
                1,
                &cancel,
                |_, _| {}
            )
            .is_err()
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
