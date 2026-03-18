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

A lightweight HTTP server using an async framework (axum or warp, whichever aligns with existing Tauri/tokio deps) that:

1. **Starts with the app** — binds to `127.0.0.1` on a random available port. The port is stored in `AppState`.
2. **Single route:** `GET /stream?url={encoded_rd_url}&token={auth_token}`
3. **Proxies with range support** — forwards the request to the Real-Debrid URL with the auth token in headers. Passes through `Range` request headers from the browser for seeking. Streams the response body back to the webview.
4. **No caching, no disk** — pure passthrough. Bytes flow from RD CDN → Rust → webview. Memory footprint stays flat (chunked streaming, not buffered).
5. **Cleanup** — server shuts down when the app exits.

**New Tauri command:** `get_stream_url`

- Input: torrent ID + file index
- Behavior: calls unrestrict on the corresponding RD link to get a direct download URL
- Output: `http://127.0.0.1:{port}/stream?url={encoded_url}&token={token}`

The proxy is stateless. All "smarts" (file resolution, auth, unrestricting) happen in the existing command layer before the URL is constructed.

### Frontend: Player UI

**Location:** Inline within the torrent detail slide-over panel (SlideOverPanel component).

**Layout:** Player appears **above** the file list when a video is playing. The file list remains visible below, allowing users to switch files without closing the player.

**Controls:** Minimal — play/pause, seek bar, volume, fullscreen. Uses the native HTML5 `<video>` controls.

**File list changes:**
- Video files playable inline (MP4, WebM, MOV, M4V) → green play button
- Video files needing external player (MKV, AVI, WMV, FLV, TS) → grey play button with external icon
- Non-video files → existing icon, no play button

### File Type Handling

| Extensions | Action |
|---|---|
| `.mp4`, `.webm`, `.mov`, `.m4v` | Inline `<video>` via Rust streaming proxy |
| `.mkv`, `.avi`, `.wmv`, `.flv`, `.ts` | "Open in external player" — unrestrict link, open URL via Tauri `opener` plugin, toast: "Opening in external player..." |
| All other extensions | No play button |

### Format Fallback

If an inline-eligible file fails to play (browser `<video>` `onerror` event), automatically offer "Open in external player" as a fallback.

## State Management

Local component state only — no new React context or global state.

```typescript
interface StreamingState {
  streamingFileIndex: number | null;  // which file is playing (null = no player)
  streamUrl: string | null;           // local proxy URL
  isLoading: boolean;                 // true while unrestricting + preparing URL
  error: string | null;               // error message if unrestrict/proxy fails
}
```

## UX Flow

1. User opens torrent detail slide-over (existing behavior)
2. File list shows play buttons on video files (green for inline, grey for external)
3. User clicks inline play → loading spinner on that file row
4. Backend unrestricts the link, returns local proxy URL
5. Player appears above file list, video begins loading/playing
6. Currently-playing file row is highlighted (accent color border)
7. Click play on a different video file → swaps the stream
8. Click the playing file's play button again → stops playback, player disappears
9. Close slide-over → player unmounts, stream stops

## Error Handling

| Scenario | Behavior |
|---|---|
| Unrestrict fails (expired torrent, RD outage) | Error message in player area: "Couldn't load stream. Try again?" with retry button |
| Format unsupported by browser engine | `<video>` `onerror` fires → auto-offer "Open in external player" fallback |
| Network drops mid-stream | Browser's native buffering/error UI handles it |

## Files to Create/Modify

### New files
- `src-tauri/src/streaming.rs` — HTTP streaming proxy server

### Modified files
- `src-tauri/src/lib.rs` — register streaming server startup + new command
- `src-tauri/src/state.rs` — add streaming server port to AppState
- `src-tauri/src/commands/downloads.rs` (or new `commands/streaming.rs`) — `get_stream_url` command
- `src/api/streaming.ts` — `invoke` wrapper for `get_stream_url`
- `src/components/TorrentDetail.tsx` (or SlideOverPanel) — add player UI + play buttons to file list
- `src/types/index.ts` — add streaming-related types if needed

## Out of Scope

- Transcoding / remuxing (MKV → MP4 on the fly)
- Audio file playback
- Document/image preview
- Picture-in-picture mode
- Playback speed controls
- Subtitle support
- Download button on player

These can be added later without architectural changes.
