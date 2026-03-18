# Inline Video Streaming Preview

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Add inline video preview to the torrent detail slide-over panel

## Summary

Add the ability to stream video files directly from Real-Debrid within the torrent detail slide-over. A Rust-side HTTP proxy handles authentication and range requests. The HTML5 `<video>` element plays MP4/WebM/MOV natively; unsupported formats (MKV, AVI, etc.) fall back to opening in the system's default video player.

## Motivation

Users currently must download an entire file before they can check its contents. Inline streaming lets them verify a file in seconds — right where they're already browsing their torrent's file list.

## Architecture

### Backend: Streaming Proxy

**New module:** `src-tauri/src/streaming.rs`

A lightweight HTTP server using `axum` (shares the `tokio` + `hyper` stack that `reqwest` already pulls in, minimizing new dependencies):

1. **Starts with the app** — spawned as a tokio task inside the Tauri `setup` hook. Binds to `127.0.0.1` on a random available port (`TcpListener::bind("127.0.0.1:0")`). The port is stored in `AppState.streaming_port: RwLock<Option<u16>>`, set after the listener binds and before the webview loads.
2. **Single route:** `GET /stream/{session_id}`
3. **Session-based auth** — the proxy never receives raw RD credentials in URLs. Instead, `get_stream_url` generates a short-lived opaque session key (random UUID) stored in an `AppState.stream_sessions: RwLock<HashMap<String, StreamSession>>` map. Each `StreamSession` contains the real RD direct URL (already unrestricted). The proxy looks up the session ID, retrieves the URL, and proxies the request. Sessions are cleaned up when the slide-over closes or after a timeout (e.g., 30 minutes).
4. **Proxies with range support** — forwards the request to the RD direct URL. Passes through `Range` request headers from the browser for seeking. Streams the response body back to the webview using chunked transfer (not buffered in memory).
5. **CORS headers** — proxy responses include `Access-Control-Allow-Origin: *` to ensure the Tauri webview accepts the response.
6. **No caching, no disk** — pure passthrough. Bytes flow from RD CDN → Rust → webview. Memory footprint stays flat.
7. **Cleanup** — server shuts down when the app exits (tied to the tokio runtime).

**New Tauri command:** `get_stream_url`

- Input: `torrent_id: String` + `file_id: u32` (the `TorrentFile.id` field, **not** the positional index — RD file IDs are 1-based and can have gaps)
- Precondition: torrent must have status `"downloaded"`. If not, return an error: "Torrent is not ready for streaming."
- Behavior:
  1. Fetch torrent info via `GET /torrents/info/{torrent_id}`
  2. Map `file_id` to the corresponding link: filter `torrent_info.files` to selected files only, find the positional index of the file with matching `id`, then index into `torrent_info.links` at that position (RD's `links` array corresponds 1:1 with selected files in order)
  3. Unrestrict the link via `POST /unrestrict/link`
  4. Generate a random UUID session key
  5. Store `StreamSession { url: unrestricted_url, created_at: Instant::now() }` in `AppState.stream_sessions`
  6. Return `http://127.0.0.1:{port}/stream/{session_id}`
- Output: the local proxy URL that the frontend can plug into `<video src>`

**New Tauri command:** `cleanup_stream_session`

- Input: `session_id: String`
- Behavior: removes the session from `stream_sessions` map
- Called by the frontend when the player unmounts or the slide-over closes

### Tauri CSP Configuration

Add `http://127.0.0.1` to the `media-src` directive in `src-tauri/tauri.conf.json` so the webview allows `<video>` to load from the local proxy. If a wildcard port is needed, use `http://127.0.0.1:*` or the specific port pattern supported by Tauri v2's CSP configuration.

### Frontend: Player UI

**Location:** Inline within the torrent detail slide-over panel (SlideOverPanel component).

**Layout:** Player appears **above** the file list when a video is playing. The file list remains visible and scrollable below. The slide-over panel widens to **640px** when a video is actively playing (animated transition) to give the 16:9 player a reasonable viewport (~360px tall). Returns to default width when playback stops.

**Controls:** Minimal — native HTML5 `<video controls>` which provides play/pause, seek bar, volume, fullscreen. Fullscreen is the recommended way to watch anything longer than a quick preview.

**File list changes:**
- Video files playable inline (MP4, WebM, MOV, M4V) → green play button icon
- Video files needing external player (MKV, AVI, WMV, FLV, TS) → grey play button with small external-link icon
- Non-video files → existing icon, no play button
- Play buttons only appear on files belonging to torrents with status `"downloaded"`

### File Type Handling

| Extensions | Action |
|---|---|
| `.mp4`, `.webm`, `.mov`, `.m4v` | Inline `<video>` via Rust streaming proxy |
| `.mkv`, `.avi`, `.wmv`, `.flv`, `.ts` | "Open in external player" — unrestrict link, open URL via Tauri `opener` plugin, toast: "Opening in external player..." |
| All other extensions | No play button |

### Format Fallback

If an inline-eligible file fails to play (browser `<video>` `onerror` event), automatically offer "Open in external player" as a fallback button in the player area.

## State Management

Local component state only — no new React context or global state.

```typescript
interface StreamingState {
  streamingFileId: number | null;   // TorrentFile.id of currently playing file (null = no player)
  streamUrl: string | null;         // local proxy URL
  sessionId: string | null;         // for cleanup on unmount
  isLoading: boolean;               // true while unrestricting + preparing URL
  error: string | null;             // error message if unrestrict/proxy fails
}
```

## UX Flow

1. User opens torrent detail slide-over (existing behavior)
2. File list shows play buttons on video files (green for inline, grey for external) — only for downloaded torrents
3. User clicks inline play → loading spinner on that file row
4. Backend unrestricts the link, creates stream session, returns local proxy URL
5. Slide-over widens to 640px, player appears above file list, video begins loading/playing
6. Currently-playing file row is highlighted (accent color border)
7. Click play on a different video file → cleanup old session, swap the stream
8. Click the playing file's play button again → stops playback, player disappears, panel returns to default width
9. Close slide-over → player unmounts, `cleanup_stream_session` called, panel resets

## Error Handling

| Scenario | Behavior |
|---|---|
| Unrestrict fails (expired torrent, RD outage) | Error message in player area: "Couldn't load stream. Try again?" with retry button |
| Torrent not in "downloaded" status | No play buttons shown on files |
| File ID → link mapping fails | Error message: "File not available for streaming" |
| Format unsupported by browser engine | `<video>` `onerror` fires → auto-offer "Open in external player" fallback |
| Network drops mid-stream | Browser's native buffering/error UI handles it |
| Stream session expired/missing | Proxy returns 404 → frontend shows error with retry (re-creates session) |

## Files to Create/Modify

### New files
- `src-tauri/src/streaming.rs` — HTTP streaming proxy server (axum)
- `src/api/streaming.ts` — `invoke` wrappers for `get_stream_url` and `cleanup_stream_session`

### Modified files
- `src-tauri/Cargo.toml` — add `axum` dependency
- `src-tauri/src/lib.rs` — spawn streaming server in `setup` hook, register new commands
- `src-tauri/src/state.rs` — add `streaming_port: RwLock<Option<u16>>` and `stream_sessions: RwLock<HashMap<String, StreamSession>>` to AppState
- `src-tauri/src/commands/` — new `commands/streaming.rs` for `get_stream_url` and `cleanup_stream_session`
- `src-tauri/tauri.conf.json` — add `http://127.0.0.1` to CSP `media-src`
- `src/components/TorrentDetail.tsx` (or equivalent slide-over component) — add player UI, play buttons to file list, panel width transition
- `src/types/index.ts` — add `StreamSession` and streaming-related types

## Out of Scope

- Transcoding / remuxing (MKV → MP4 on the fly)
- Audio file playback
- Document/image preview
- Picture-in-picture mode
- Playback speed controls
- Subtitle support
- Download button on player
- Persistent watch history

These can be added later without architectural changes.
