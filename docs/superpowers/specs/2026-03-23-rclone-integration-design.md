# rclone Integration — Stream Debrid Downloads to Cloud Remotes

**Date:** 2026-03-23
**Status:** Approved

## Problem

Users with rclone-mounted media libraries (Plex/Jellyfin setups) currently must download files to local disk, then manually move them to their cloud remote. This wastes local storage and adds friction. They want debrid downloads to land directly on their remote — no local disk usage.

## Solution Overview

Add rclone remote paths as a first-class download destination. The app detects whether a destination is a local path or an rclone remote (`name:path`), and pipes the HTTP stream from the debrid service directly to `rclone rcat` — zero local disk usage.

## Licensing

- DebridDownloader: GPL-3.0-or-later
- rclone: MIT license (GPL-3 compatible)
- rclone is NOT bundled — users install it themselves. The app shells out to the `rclone` binary in PATH. No license entanglement.

## Architecture

### rclone Detection

On app startup and when Settings opens, run `rclone version` as a child process.

- **Success:** Store version string, enable rclone features
- **Failure:** rclone features silently unavailable (no nagging)

New Tauri commands:
- `check_rclone() -> Option<RcloneInfo>` — returns version info or None
- `list_rclone_remotes() -> Vec<String>` — runs `rclone listremotes`, returns remote names

### Smart Destination Detection

The app detects rclone remotes by pattern: `name:` or `name:path/to/folder` (alphanumeric/hyphen/underscore name followed by a colon). Applies everywhere a destination is entered.

When an rclone remote is detected:
- Skip native folder picker validation
- Validate remote name exists via `rclone listremotes`
- If rclone not installed, show error: "This looks like an rclone remote but rclone is not installed"

### Download Engine — Piping to rclone

When `start_downloads` detects an rclone destination, it calls `download_to_rclone` instead of `download_file`:

1. **HTTP stream starts** — `reqwest::Client` GETs the debrid URL, gets a byte stream
2. **Spawn rclone child process** — `rclone rcat "remote:path/filename"` with stdin piped, stderr captured. Pass `--size` flag when total bytes are known.
3. **Pipe loop** — chunks from HTTP stream written to rclone's stdin. Progress tracked by bytes written to pipe (same counters as local downloads).
4. **Completion** — HTTP stream ends → close stdin → wait for rclone exit. Exit 0 = success, else capture stderr as error.
5. **Cancellation** — same `tokio::select!` with cancel_rx. On cancel, kill rclone child process.

### Data Model Changes

`DownloadTask` gets a new field:
```rust
pub remote: Option<String>, // None = local, Some("gdrive:Media/Movies") = rclone
```

This field is used by the frontend to show the remote indicator icon and by the backend to choose the download path (local file vs rclone pipe).

## Frontend Changes

### Download Dialog
- Destination field becomes a text input with folder picker button beside it
- Users can click picker (local) or type rclone remote path directly
- Cloud icon appears inline when rclone remote detected
- Inline error if rclone not installed and remote path entered

### Downloads Page (Active Transfers)
- Progress bars, speed, status — identical to local downloads
- Cloud icon next to filename for remote transfers
- Error states show rclone's stderr message (e.g. "quota exceeded on gdrive:")

### Settings Page
- Default download path: text input + folder picker combo
- New "rclone" status section showing detection status
- "List remotes" button that shows configured remotes
- Clickable remote names to autofill the path field

### No new pages, tabs, or navigation. Feature lives within existing UI surfaces.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| rclone not in PATH | Feature unavailable, message in Settings |
| Invalid remote name | Validation error before download starts |
| rclone exits non-zero | Capture stderr, show as download error |
| Network failure mid-stream | rclone process dies, stderr captured as error |
| User cancels | Kill rclone child process, clean up |
| Remote quota full | rclone stderr: "quota exceeded", shown in UI |

## What This Does NOT Include

- Bundling rclone binary (user installs themselves)
- rclone config UI (user configures remotes via `rclone config` outside the app)
- Resume/retry for partial rclone transfers
- rclone daemon/RC API integration
- Native cloud SDK implementations
