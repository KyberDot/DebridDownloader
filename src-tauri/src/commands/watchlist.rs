use crate::scrapers::TrackerConfig;
use crate::state::AppState;
use crate::watchlist::{self, WatchMatch, WatchRule, WatchAction, RuleType, MatchStatus};
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

// ── Store helpers ───────────────────────────────────────────────────

fn save_rules(app: &tauri::AppHandle, rules: &[WatchRule]) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let json = serde_json::to_value(rules).map_err(|e| e.to_string())?;
    store.set("watch_rules", json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn save_matches(app: &tauri::AppHandle, matches: &[WatchMatch]) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let json = serde_json::to_value(matches).map_err(|e| e.to_string())?;
    store.set("watch_matches", json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn save_seen(
    app: &tauri::AppHandle,
    seen: &std::collections::HashMap<String, std::collections::HashSet<String>>,
) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let json = serde_json::to_value(seen).map_err(|e| e.to_string())?;
    store.set("watch_seen_hashes", json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_watch_rules(state: State<'_, AppState>) -> Result<Vec<WatchRule>, String> {
    let rules = state.watch_rules.read().await;
    Ok(rules.clone())
}

#[tauri::command]
pub async fn add_watch_rule(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    if let Some(ref pattern) = rule.regex_filter {
        if !pattern.is_empty() {
            watchlist::validate_regex(pattern)?;
        }
    }

    let mut rules = state.watch_rules.write().await;
    rules.push(rule.clone());
    save_rules(&app, &rules)?;
    Ok(rule)
}

#[tauri::command]
pub async fn update_watch_rule(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    if let Some(ref pattern) = rule.regex_filter {
        if !pattern.is_empty() {
            watchlist::validate_regex(pattern)?;
        }
    }

    let mut rules = state.watch_rules.write().await;
    if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
        *existing = rule.clone();
        save_rules(&app, &rules)?;
        Ok(rule)
    } else {
        Err("Rule not found".to_string())
    }
}

#[tauri::command]
pub async fn delete_watch_rule(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut rules = state.watch_rules.write().await;
    rules.retain(|r| r.id != id);
    save_rules(&app, &rules)?;

    let mut matches = state.watch_matches.write().await;
    matches.retain(|m| m.rule_id != id);
    save_matches(&app, &matches)?;

    let mut seen = state.watch_seen.write().await;
    seen.remove(&id);
    save_seen(&app, &seen)?;

    Ok(())
}

#[tauri::command]
pub async fn get_watch_matches(
    state: State<'_, AppState>,
    rule_id: Option<String>,
) -> Result<Vec<WatchMatch>, String> {
    let matches = state.watch_matches.read().await;
    match rule_id {
        Some(id) => Ok(matches.iter().filter(|m| m.rule_id == id).cloned().collect()),
        None => Ok(matches.clone()),
    }
}

#[tauri::command]
pub async fn clear_watch_matches(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rule_id: Option<String>,
) -> Result<(), String> {
    let mut matches = state.watch_matches.write().await;
    match rule_id {
        Some(id) => matches.retain(|m| m.rule_id != id),
        None => matches.clear(),
    }
    save_matches(&app, &matches)?;
    Ok(())
}

#[tauri::command]
pub async fn run_watch_rule_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<WatchMatch>, String> {
    let rule = {
        let rules = state.watch_rules.read().await;
        rules.iter().find(|r| r.id == id).cloned()
    };

    let rule = rule.ok_or("Rule not found")?;

    let tracker_configs = load_tracker_configs(&app);
    if tracker_configs.is_empty() {
        return Err("No trackers configured".to_string());
    }

    let new_matches = watchlist::run_rule_standalone(&app, &state, &rule, &tracker_configs).await;

    if !new_matches.is_empty() {
        for m in &new_matches {
            let _ = app.emit("watchlist-match", m.clone());
        }

        let mut matches = state.watch_matches.write().await;
        matches.extend(new_matches.clone());
        if matches.len() > watchlist::MAX_MATCHES {
            let drain_count = matches.len() - watchlist::MAX_MATCHES;
            matches.drain(..drain_count);
        }
        save_matches(&app, &matches)?;

        let mut rules = state.watch_rules.write().await;
        if let Some(existing) = rules.iter_mut().find(|r| r.id == id) {
            existing.last_checked = Some(chrono::Utc::now().to_rfc3339());

            if let watchlist::RuleType::TvShow {
                ref mut last_season,
                ref mut last_episode,
            } = existing.rule_type
            {
                for m in &new_matches {
                    if let (Some(s), Some(e)) = (m.season, m.episode) {
                        let current = (last_season.unwrap_or(0), last_episode.unwrap_or(0));
                        if (s, e) > current {
                            *last_season = Some(s);
                            *last_episode = Some(e);
                        }
                    }
                }
            }
        }
        save_rules(&app, &rules)?;
    }

    Ok(new_matches)
}

fn load_tracker_configs(app: &tauri::AppHandle) -> Vec<TrackerConfig> {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    match store.get("tracker_configs") {
        Some(val) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => vec![],
    }
}
