use std::{
    io,
    path::{Path, PathBuf},
};

/// Portable Windows builds keep native state beside the executable while using
/// a Rust-specific child directory. This never reads or merges Electron data.
pub fn windows_portable_data_dir(executable: &Path) -> io::Result<PathBuf> {
    let parent = executable
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| io::Error::other("Cannot locate the portable executable directory"))?;
    Ok(parent.join("PACC-BD-data").join("rust"))
}

pub fn default_data_dir() -> io::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return windows_portable_data_dir(&std::env::current_exe()?);
    }
    #[cfg(not(target_os = "windows"))]
    {
        directories::ProjectDirs::from("io", "jsposu", "pacc-bd")
            .map(|dirs| dirs.data_local_dir().to_path_buf())
            .ok_or_else(|| io::Error::other("No local data directory available"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_state_is_beside_executable_and_separate_from_electron() {
        let executable = Path::new("/portable/PACC-BD-portable.exe");
        assert_eq!(
            windows_portable_data_dir(executable).unwrap(),
            Path::new("/portable/PACC-BD-data/rust")
        );
    }
}
