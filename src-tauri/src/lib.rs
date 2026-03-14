mod api;
mod commands;
mod downloader;
mod scrapers;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::set_api_token,
            commands::auth::load_saved_token,
            commands::auth::logout,
            commands::auth::is_authenticated,
            commands::auth::get_user,
            commands::auth::oauth_start,
            commands::auth::oauth_poll_credentials,
            commands::auth::oauth_get_token,
            // Torrents
            commands::torrents::list_torrents,
            commands::torrents::get_torrent_info,
            commands::torrents::add_magnet,
            commands::torrents::add_torrent_file,
            commands::torrents::select_torrent_files,
            commands::torrents::delete_torrent,
            // Downloads
            commands::downloads::unrestrict_link,
            commands::downloads::unrestrict_torrent_links,
            commands::downloads::start_downloads,
            commands::downloads::cancel_download,
            commands::downloads::get_download_tasks,
            commands::downloads::clear_completed_downloads,
            commands::downloads::get_download_history,
            // Settings
            commands::settings::get_settings,
            commands::settings::update_settings,
            // Search
            commands::search::search_torrents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
