use std::{io, path::Path, process::Command};

/// Pass the configured path as a single OS argument, never through a shell.
pub fn folder_command(directory: &Path) -> io::Result<Command> {
    if !directory.is_absolute() || directory.parent().is_none() {
        return Err(io::Error::other(
            "Choose an absolute download folder, not a filesystem root",
        ));
    }
    let program = if cfg!(target_os = "windows") {
        "explorer.exe"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut command = Command::new(program);
    command.arg(directory);
    Ok(command)
}

pub fn open_download_folder(directory: &Path) -> io::Result<()> {
    let mut command = folder_command(directory)?;
    std::fs::create_dir_all(directory)?;
    // Explorer can return nonzero after successfully handing off to an existing
    // instance. On Windows, report launch errors rather than its exit code.
    if cfg!(target_os = "windows") {
        let mut child = command.spawn()?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(());
    }
    let status = command.status()?;
    if !status.success() {
        return Err(io::Error::other(format!("File manager returned {status}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_paths_with_spaces_and_metacharacters_are_one_literal_argument() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("maps with spaces & symbols");
        let command = folder_command(&path).unwrap();
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![path.as_os_str()]
        );
        assert!(
            !path.exists(),
            "building the command must not open or create anything"
        );
    }
    #[test]
    fn relative_and_root_paths_are_rejected() {
        assert!(folder_command(Path::new("relative")).is_err());
        let root = if cfg!(windows) {
            Path::new("C:\\")
        } else {
            Path::new("/")
        };
        assert!(folder_command(root).is_err());
    }
}
