# Watch List / RSS Automation — Design Spec

## Overview

Add a watch list feature that monitors user-configured trackers for new content matching saved rules, with two rule types: freeform **Keyword** matching and smart **TV Show** episode tracking. Each rule can be configured to either notify the user or automatically add matched torrents to their debrid provider.

## Data Model

### WatchRule

Persisted in Tauri plugin-store (`settings.json`) under key `watch_rules`.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchRule {
    pub id: String,                    // UUID v4
    pub name: String,                  // user-facing label
    pub rule_type: RuleType,           // Keyword or TvShow
    pub query: String,                 // search query sent to scrapers
    pub category: Option<String>,      // "tv", "movies", "music", "games", "software"
    pub regex_filter: Option<String>,  // optional regex applied to result titles
    pub min_seeders: Option<u32>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub action: WatchAction,           // Notify or AutoAdd
    pub interval_minutes: u32,         // polling interval (default 30)
    pub enabled: bool,
    pub created_at: String,            // ISO 8601
    pub last_checked: Option<String>,  // ISO 8601
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RuleType {
    Keyword,
    TvShow {
        last_season: Option<u32>,
        last_episode: Option<u32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WatchAction {
    Notify,
    AutoAdd,
}
```

### WatchMatch

Persisted in Tauri plugin-store under key `watch_matches`. Capped at 500 entries; oldest pruned on insert.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchMatch {
    pub rule_id: String,
    pub info_hash: String,
    pub title: String,
    pub matched_at: String,            // ISO 8601
    pub action_taken: WatchAction,
    pub season: Option<u32>,           // parsed from title (TV rules)
    pub episode: Option<u32>,          // parsed from title (TV rules)
}
```

The seen-hashes set is derived from `WatchMatch` records on startup — no separate dedup store.

## Backend Engine

### Episode Parser

Utility function in `watchlist.rs`:

```
parse_episode("Show.Name.S03E07.1080p...") → Some((3, 7))
parse_episode("Show.Name.S3E7.720p...")    → Some((3, 7))
parse_episode("Show.Name.3x07.HDTV...")    → Some((3, 7))
parse_episode("random.linux.iso")          → None
```

Regex patterns (case-insensitive):
- `S(\d{1,2})E(\d{1,2})`
- `(\d{1,2})x(\d{2})`

### Watch Loop

New module: `src-tauri/src/watchlist.rs`

Single tokio task spawned at app startup, loops:

1. Sleep 60 seconds (tick interval)
2. For each enabled rule where `now - last_checked >= interval_minutes`:
   a. Call `search_all()` with the rule's query + category against user's tracker configs
   b. Filter results: apply regex filter if set, check min_seeders/size bounds
   c. **Keyword rules:** skip results whose `info_hash` is in the seen set
   d. **TvShow rules:** parse episode from each title, skip if `(season, episode) <= (last_season, last_episode)`, skip seen hashes
   e. For each new match:
      - Record a `WatchMatch`
      - If `AutoAdd`: call `provider.add_magnet()`, then `provider.select_files()`, then emit `start-downloads` event
      - If `Notify`: emit `watchlist-match` Tauri event to frontend
   f. Update `last_checked` on the rule
   g. For TV rules, update `last_season`/`last_episode` to highest seen
   h. Persist updated rules + matches to the store

### Tauri Commands

New file: `src-tauri/src/commands/watchlist.rs`

- `get_watch_rules() → Vec<WatchRule>`
- `add_watch_rule(rule) → WatchRule`
- `update_watch_rule(rule) → WatchRule`
- `delete_watch_rule(id)`
- `get_watch_matches(rule_id: Option<String>) → Vec<WatchMatch>`
- `clear_watch_matches(rule_id: Option<String>)`
- `run_watch_rule_now(id)` — manual trigger for testing

## Persistence & State Integration

### AppState Changes

```rust
pub struct AppState {
    // ...existing fields...
    pub watch_rules: Arc<RwLock<Vec<WatchRule>>>,
    pub watch_matches: Arc<RwLock<Vec<WatchMatch>>>,
}
```

### Startup Sequence

1. Load `watch_rules` and `watch_matches` from plugin-store in `setup()`
2. Populate `AppState` fields
3. Spawn `watchlist::start_watch_loop(app_handle)` as a detached tokio task

### Auto-Add Flow

When a match triggers auto-add:

1. `provider.add_magnet(magnet)` — adds to debrid service
2. Wait briefly, then `provider.select_files(id, all_file_ids)` — select all files
3. If download folder is configured, emit `start-downloads` event (same flow as manual)

This keeps auto-add consistent with the existing manual download path.

### Storage Limits

- `watch_matches` capped at 500 entries, oldest pruned on insert
- No limit on `watch_rules` (practical limit is user-managed)

## Frontend

### Sidebar

New entry: "Watch List" with eye icon, positioned between Search and Downloads. Badge shows count of unread matches (matches since user last visited the page).

### Watch List Page Layout

**Top panel: Rules list**

Table showing all watch rules:
- Columns: Name, Type (Keyword/TV badge), Query, Action (Notify/Auto-Add badge), Interval, Last Checked, Enabled toggle
- TV rules show tracking position badge (e.g., "S03E07")
- "Add Rule" button opens modal
- Row actions: Edit, Run Now, Delete

**Bottom panel: Recent Matches**

Filtered by selected rule (or show all):
- Columns: Title, Rule Name, Matched At, Action Taken, Size
- Auto-added matches show link icon to jump to Torrents page
- "Clear" button to purge match history

### Add/Edit Rule Modal

Fields:
- Name (text input)
- Rule type toggle: Keyword / TV Show
- Query string (text input)
- Category dropdown: All, Movies, TV, Music, Games, Software
- For TV Show type: Season/Episode number fields (optional — auto-detected from first match if blank)
- Advanced section (collapsible): regex filter, min seeders, min/max size
- Action toggle: Notify / Auto-Add
- Interval dropdown: 15m, 30m, 1h, 2h, 6h

### Notifications

- `watchlist-match` event triggers a toast when user is not on Watch List page
- Sidebar badge increments with unread match count

## Files to Create/Modify

### New Files
- `src-tauri/src/watchlist.rs` — watch engine, episode parser, watch loop
- `src-tauri/src/commands/watchlist.rs` — Tauri command handlers
- `src/pages/WatchListPage.tsx` — full watch list page
- `src/api/watchlist.ts` — invoke() wrappers

### Modified Files
- `src-tauri/src/state.rs` — add watch_rules/watch_matches to AppState
- `src-tauri/src/lib.rs` — register commands, spawn watch loop in setup
- `src-tauri/src/commands/mod.rs` — add watchlist module
- `src/types/index.ts` — add WatchRule, WatchMatch, RuleType, WatchAction interfaces
- `src/components/Sidebar.tsx` — add Watch List nav entry with badge
- `src/App.tsx` (or router config) — add route for Watch List page
