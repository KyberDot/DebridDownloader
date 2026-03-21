use tauri::command;
use crate::PendingMagnetUri;

const MAX_MAGNET_URI_LENGTH: usize = 8192;

/// Validate that a URI is a well-formed magnet link.
pub fn validate_magnet_uri(uri: &str) -> bool {
    let trimmed = uri.trim();
    if trimmed.len() > MAX_MAGNET_URI_LENGTH {
        return false;
    }
    if !trimmed.starts_with("magnet:?") {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if !lower.contains("xt=urn:btih:") {
        return false;
    }
    true
}

/// Register or unregister the app as the default magnet: URI handler.
#[command]
pub async fn set_magnet_handler(enabled: bool) -> Result<(), String> {
    if enabled {
        register_magnet_handler().map_err(|e| e.to_string())
    } else {
        unregister_magnet_handler().map_err(|e| e.to_string())
    }
}

/// Retrieve and consume a pending magnet URI from cold start.
#[command]
pub async fn get_pending_magnet_uri(
    state: tauri::State<'_, PendingMagnetUri>,
) -> Result<Option<String>, String> {
    let mut pending = state.0.lock().map_err(|e| e.to_string())?;
    Ok(pending.take())
}

#[cfg(target_os = "macos")]
fn register_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;
    let bundle_id = "com.jonathan.debriddownloader";
    let swift_code = format!(
        r#"import Foundation; import CoreServices; let _ = LSSetDefaultHandlerForURLScheme("magnet" as CFString, "{}" as CFString)"#,
        bundle_id
    );
    let status = Command::new("/usr/bin/swift")
        .args(["-e", &swift_code])
        .status()?;
    if !status.success() {
        return Err("Failed to register magnet handler via LSSetDefaultHandlerForURLScheme".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn unregister_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    log::info!("macOS: magnet handler unregistration is a no-op. Another app must reclaim the scheme.");
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    use std::env;
    use winreg::enums::*;
    use winreg::RegKey;

    let exe_path = env::current_exe()?.to_string_lossy().to_string();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (magnet_key, _) = hkcu.create_subkey(r"Software\Classes\magnet")?;
    magnet_key.set_value("", &"URL:Magnet Protocol")?;
    magnet_key.set_value("URL Protocol", &"")?;

    let (command_key, _) = magnet_key.create_subkey(r"shell\open\command")?;
    command_key.set_value("", &format!("\"{}\" \"%1\"", exe_path))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn unregister_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.delete_subkey_all(r"Software\Classes\magnet") {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(target_os = "linux")]
fn register_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    use std::env;
    use std::fs;
    use std::process::Command;

    let exe_path = env::current_exe()?.to_string_lossy().to_string();
    let desktop_entry = format!(
        "[Desktop Entry]\nType=Application\nName=DebridDownloader\nExec={} %u\nMimeType=x-scheme-handler/magnet;\nNoDisplay=true\n",
        exe_path
    );

    let data_dir = dirs::data_dir()
        .ok_or("Could not find XDG data directory")?;
    let applications_dir = data_dir.join("applications");
    fs::create_dir_all(&applications_dir)?;

    let desktop_file = applications_dir.join("debriddownloader-magnet.desktop");
    fs::write(&desktop_file, desktop_entry)?;

    Command::new("xdg-mime")
        .args(["default", "debriddownloader-magnet.desktop", "x-scheme-handler/magnet"])
        .status()?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn unregister_magnet_handler() -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    let data_dir = dirs::data_dir()
        .ok_or("Could not find XDG data directory")?;
    let desktop_file = data_dir.join("applications/debriddownloader-magnet.desktop");

    match fs::remove_file(&desktop_file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
