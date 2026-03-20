use crate::api::types::{DownloadItem, UnrestrictedLink};
use crate::downloader;
use crate::state::{AppState, DownloadStatus, DownloadTask};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn unrestrict_link(
    state: State<'_, AppState>,
    link: String,
) -> Result<UnrestrictedLink, String> {
    state
        .client
        .unrestrict_link(&link)
        .await
        .map_err(|e| format!("{}", e))
}

/// Unrestrict all links from a torrent and return direct download URLs
#[tauri::command]
pub async fn unrestrict_torrent_links(
    state: State<'_, AppState>,
    torrent_id: String,
) -> Result<Vec<UnrestrictedLink>, String> {
    let info = state
        .client
        .torrent_info(&torrent_id)
        .await
        .map_err(|e| format!("{}", e))?;

    let mut results = Vec::new();
    for link in &info.links {
        match state.client.unrestrict_link(link).await {
            Ok(unrestricted) => results.push(unrestricted),
            Err(e) => {
                log::warn!("Failed to unrestrict link {}: {}", link, e);
                // Continue with other links
            }
        }
    }

    Ok(results)
}

/// Start downloading files to a folder
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    links: Vec<UnrestrictedLink>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.read().await;
    let create_subfolders = settings.create_torrent_subfolders;
    let max_concurrent = settings.max_concurrent_downloads as usize;
    drop(settings);

    let mut task_ids = Vec::new();

    for link in &links {
        let id = uuid::Uuid::new_v4().to_string();
        let dest = if create_subfolders {
            if let Some(ref name) = torrent_name {
                PathBuf::from(&destination_folder)
                    .join(sanitize_filename(name))
                    .join(sanitize_filename(&link.filename))
            } else {
                PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
            }
        } else {
            PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
        };

        let task = DownloadTask {
            id: id.clone(),
            filename: link.filename.clone(),
            url: link.download.clone(),
            destination: dest.to_string_lossy().to_string(),
            total_bytes: link.filesize,
            downloaded_bytes: 0,
            speed: 0.0,
            status: DownloadStatus::Pending,
        };

        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        state.active_downloads.write().await.insert(id.clone(), task);
        state.cancel_tokens.write().await.insert(id.clone(), cancel_tx);
        task_ids.push((id, cancel_rx));
    }

    let ids: Vec<String> = task_ids.iter().map(|(id, _)| id.clone()).collect();

    // Spawn download workers
    let client = state.client.clone();
    let active_downloads = state.active_downloads.clone();
    let cancel_tokens_map = state.cancel_tokens.clone();

    tokio::spawn(async move {
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
        let mut handles = Vec::new();

        for (id, mut cancel_rx) in task_ids {
            let sem = semaphore.clone();
            let client = client.clone();
            let app = app.clone();
            let downloads = active_downloads.clone();
            let cancel_map = cancel_tokens_map.clone();

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                // Get task data
                let mut task = {
                    let dl = downloads.read().await;
                    match dl.get(&id) {
                        Some(t) => t.clone(),
                        None => return,
                    }
                };

                // Run download
                let result =
                    downloader::download_file(app, &client, &mut task, &mut cancel_rx).await;

                // Update final state
                if let Err(e) = result {
                    task.status = DownloadStatus::Failed(e);
                }

                downloads.write().await.insert(id.clone(), task);
                cancel_map.write().await.remove(&id);
            });

            handles.push(handle);
        }

        // Wait for all downloads
        for handle in handles {
            let _ = handle.await;
        }
    });

    Ok(ids)
}

/// Cancel a specific download
#[tauri::command]
pub async fn cancel_download(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    if let Some(tx) = state.cancel_tokens.read().await.get(&id) {
        let _ = tx.send(true);
    }
    Ok(())
}

/// Cancel all active downloads and clear everything
#[tauri::command]
pub async fn cancel_all_downloads(
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Cancel all active downloads
    let tokens = state.cancel_tokens.read().await;
    for tx in tokens.values() {
        let _ = tx.send(true);
    }
    drop(tokens);
    state.cancel_tokens.write().await.clear();
    state.active_downloads.write().await.clear();
    Ok(())
}

/// Get all active/recent download tasks
#[tauri::command]
pub async fn get_download_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<DownloadTask>, String> {
    let downloads = state.active_downloads.read().await;
    Ok(downloads.values().cloned().collect())
}

/// Remove a single download from the list
#[tauri::command]
pub async fn remove_download(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Cancel if still active
    if let Some(tx) = state.cancel_tokens.read().await.get(&id) {
        let _ = tx.send(true);
    }
    state.cancel_tokens.write().await.remove(&id);
    state.active_downloads.write().await.remove(&id);
    Ok(())
}

/// Clear completed/failed/cancelled downloads from the list
#[tauri::command]
pub async fn clear_completed_downloads(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut downloads = state.active_downloads.write().await;
    downloads.retain(|_, task| {
        matches!(
            task.status,
            DownloadStatus::Pending | DownloadStatus::Downloading | DownloadStatus::Paused
        )
    });
    Ok(())
}

/// Get download history from Real-Debrid
#[tauri::command]
pub async fn get_download_history(
    state: State<'_, AppState>,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<DownloadItem>, String> {
    state
        .client
        .list_downloads(page, limit)
        .await
        .map_err(|e| format!("{}", e))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}
