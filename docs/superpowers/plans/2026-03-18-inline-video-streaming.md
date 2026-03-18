# Inline Video Streaming Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline video preview to the torrent detail slide-over — stream video files from Real-Debrid via a Rust proxy, with external player fallback for unsupported formats.

**Architecture:** A Rust-side axum HTTP server proxies Real-Debrid streams with session-based auth and range request support. The frontend adds an HTML5 `<video>` player above the file list in the torrent detail panel. Unsupported formats open in the system default video player.

**Tech Stack:** Rust (axum, tokio, reqwest), React 19, TypeScript, Tauri v2, HTML5 `<video>`

**Spec:** `docs/superpowers/specs/2026-03-18-inline-video-streaming-design.md`

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src-tauri/src/streaming.rs` | Axum HTTP server: single `/stream/{session_id}` route, range request proxying, CORS headers |
| `src-tauri/src/commands/streaming.rs` | Tauri commands: `get_stream_url`, `cleanup_stream_session` |
| `src/api/streaming.ts` | Frontend invoke wrappers for streaming commands |
| `src/components/VideoPlayer.tsx` | Inline `<video>` player component with error fallback UI |

### Modified files
| File | Changes |
|---|---|
| `src-tauri/Cargo.toml` | Add `axum` dependency |
| `src-tauri/src/state.rs` | Add `StreamSession` struct, `streaming_port` and `stream_sessions` fields to `AppState` |
| `src-tauri/src/lib.rs` | Add `mod streaming`, spawn proxy in setup hook, register new commands |
| `src-tauri/src/commands/mod.rs` | Add `pub mod streaming` |
| `src/components/SlideOverPanel.tsx` | Accept optional `width` prop for dynamic widening |
| `src/pages/TorrentsPage.tsx` | Add streaming state, play buttons on file rows, mount VideoPlayer, handle panel widening |
| `src/types/index.ts` | Add `StreamUrlResponse` type |

---

## Task 1: Add axum dependency and StreamSession state

**Files:**
- Modify: `src-tauri/Cargo.toml:16-34`
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Add axum to Cargo.toml**

In `src-tauri/Cargo.toml`, add after line 25 (`reqwest`):

```toml
axum = "0.8"
```

- [ ] **Step 2: Add StreamSession and streaming fields to AppState**

In `src-tauri/src/state.rs`, add the `Instant` import and `StreamSession` struct, then extend `AppState`:

```rust
// Add to imports at top:
use std::time::Instant;

// Add after DownloadStatus enum (after line 46):
pub struct StreamSession {
    pub url: String,
    pub created_at: Instant,
}

// Add to AppState struct (after cancel_tokens field):
    pub streaming_port: Arc<RwLock<Option<u16>>>,
    pub stream_sessions: Arc<RwLock<HashMap<String, StreamSession>>>,

// Add to AppState::new() (after cancel_tokens init):
            streaming_port: Arc::new(RwLock::new(None)),
            stream_sessions: Arc::new(RwLock::new(HashMap::new())),
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors (warnings OK)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/state.rs
git commit -m "feat(streaming): add axum dep and StreamSession state"
```

---

## Task 2: Build the streaming proxy server

**Files:**
- Create: `src-tauri/src/streaming.rs`

- [ ] **Step 1: Create the streaming proxy module**

Create `src-tauri/src/streaming.rs`:

```rust
use crate::state::{AppState, StreamSession};
use axum::{
    body::Body,
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, Response, StatusCode},
    routing::get,
    Router,
};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

type Sessions = Arc<RwLock<HashMap<String, StreamSession>>>;

pub async fn start_streaming_server(
    sessions: Sessions,
    port_holder: Arc<RwLock<Option<u16>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::new();
    let app_state = (sessions, client);

    let app = Router::new()
        .route("/stream/{session_id}", get(handle_stream))
        .with_state(app_state);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    // Store the port so Tauri commands can build URLs
    *port_holder.write().await = Some(port);

    log::info!("Streaming proxy started on 127.0.0.1:{}", port);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_stream(
    Path(session_id): Path<String>,
    headers: HeaderMap,
    AxumState((sessions, client)): AxumState<(Sessions, Client)>,
) -> Result<Response<Body>, StatusCode> {
    // Look up session
    let session_url = {
        let sessions = sessions.read().await;
        sessions
            .get(&session_id)
            .map(|s| s.url.clone())
            .ok_or(StatusCode::NOT_FOUND)?
    };

    // Build proxied request, forwarding Range header for seeking
    let mut req = client.get(&session_url);
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }

    let upstream = req.send().await.map_err(|e| {
        log::error!("Streaming proxy upstream error: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();

    // Build response with CORS and relevant upstream headers
    let mut builder = Response::builder()
        .status(status.as_u16())
        .header("Access-Control-Allow-Origin", "*");

    // Forward content headers from upstream
    for key in &[
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(val) = upstream_headers.get(key) {
            builder = builder.header(key, val);
        }
    }

    let body = Body::from_stream(upstream.bytes_stream());
    builder.body(body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && cargo check --manifest-path src-tauri/Cargo.toml`

Note: This won't compile yet because `streaming` isn't registered as a module in `lib.rs`. That's fine — we'll wire it up in the next task. Just verify there are no syntax errors in the file itself by checking the compiler output focuses on "module not found" rather than code errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/streaming.rs
git commit -m "feat(streaming): add axum streaming proxy server"
```

---

## Task 3: Wire up proxy server in Tauri setup + add streaming commands

**Files:**
- Create: `src-tauri/src/commands/streaming.rs`
- Modify: `src-tauri/src/commands/mod.rs:1-5`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create streaming commands**

Create `src-tauri/src/commands/streaming.rs`:

```rust
use crate::state::{AppState, StreamSession};
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_stream_url(
    state: State<'_, AppState>,
    torrent_id: String,
    file_id: u64,
) -> Result<serde_json::Value, String> {
    // Check streaming server is running
    let port = state
        .streaming_port
        .read()
        .await
        .ok_or("Streaming server not running")?;

    // Fetch torrent info
    let info = state
        .client
        .torrent_info(&torrent_id)
        .await
        .map_err(|e| format!("Failed to fetch torrent info: {}", e))?;

    // Precondition: torrent must be downloaded
    if info.status != "downloaded" {
        return Err("Torrent is not ready for streaming.".to_string());
    }

    // Map file_id to link index:
    // RD's links array corresponds 1:1 with selected files in order
    let selected_files: Vec<_> = info.files.iter().filter(|f| f.selected == 1).collect();
    let link_index = selected_files
        .iter()
        .position(|f| f.id == file_id)
        .ok_or("File not available for streaming")?;

    let link = info
        .links
        .get(link_index)
        .ok_or("No link available for this file")?;

    // Unrestrict the link
    let unrestricted = state
        .client
        .unrestrict_link(link)
        .await
        .map_err(|e| format!("Failed to unrestrict link: {}", e))?;

    // Create session
    let session_id = Uuid::new_v4().to_string();
    let session = StreamSession {
        url: unrestricted.download,
        created_at: Instant::now(),
    };

    state
        .stream_sessions
        .write()
        .await
        .insert(session_id.clone(), session);

    let stream_url = format!("http://127.0.0.1:{}/stream/{}", port, session_id);

    Ok(serde_json::json!({
        "stream_url": stream_url,
        "session_id": session_id
    }))
}

#[tauri::command]
pub async fn cleanup_stream_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.stream_sessions.write().await.remove(&session_id);
    Ok(())
}
```

- [ ] **Step 2: Register streaming module in commands/mod.rs**

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub mod streaming;
```

- [ ] **Step 3: Wire up proxy and commands in lib.rs**

In `src-tauri/src/lib.rs`:

Add `mod streaming;` after line 4 (`mod state;`).

In the `.setup(|app| {` closure, add before `Ok(())` (line 72):

```rust
            // Start streaming proxy server
            let state: tauri::State<'_, AppState> = app.state();
            let sessions = state.stream_sessions.clone();
            let port_holder = state.streaming_port.clone();
            tokio::spawn(async move {
                if let Err(e) = streaming::start_streaming_server(sessions, port_holder).await {
                    log::error!("Streaming server failed: {}", e);
                }
            });
```

In the `generate_handler![]` macro, add after the Search section:

```rust
            // Streaming
            commands::streaming::get_stream_url,
            commands::streaming::cleanup_stream_session,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/streaming.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(streaming): add streaming commands and wire proxy into Tauri setup"
```

---

## Task 4: Frontend invoke wrappers and types

**Files:**
- Create: `src/api/streaming.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add StreamUrlResponse type**

In `src/types/index.ts`, add at the end:

```typescript
// Streaming
export interface StreamUrlResponse {
  stream_url: string;
  session_id: string;
}
```

- [ ] **Step 2: Create streaming API wrappers**

Create `src/api/streaming.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { StreamUrlResponse } from "../types";

export async function getStreamUrl(
  torrentId: string,
  fileId: number
): Promise<StreamUrlResponse> {
  return invoke("get_stream_url", { torrentId, fileId });
}

export async function cleanupStreamSession(
  sessionId: string
): Promise<void> {
  return invoke("cleanup_stream_session", { sessionId });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/api/streaming.ts src/types/index.ts
git commit -m "feat(streaming): add frontend invoke wrappers and types"
```

---

## Task 5: VideoPlayer component

**Files:**
- Create: `src/components/VideoPlayer.tsx`

- [ ] **Step 1: Create the VideoPlayer component**

Create `src/components/VideoPlayer.tsx`:

```tsx
import { useState, useRef, useCallback } from "react";

interface VideoPlayerProps {
  streamUrl: string;
  filename: string;
  onClose: () => void;
  onExternalPlayer: () => void;
}

export default function VideoPlayer({
  streamUrl,
  filename,
  onClose,
  onExternalPlayer,
}: VideoPlayerProps) {
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  if (error) {
    return (
      <div className="mx-6 mt-5 rounded-[10px] overflow-hidden bg-black/40 border border-[var(--theme-border-subtle)]">
        <div className="flex flex-col items-center justify-center py-8 px-4 gap-3">
          <p className="text-[14px] text-[var(--theme-text-secondary)] text-center">
            Can't play this format in the browser.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onExternalPlayer}
              className="px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
            >
              Open in External Player
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
              style={{ background: "var(--theme-hover)" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-6 mt-5 rounded-[10px] overflow-hidden bg-black relative group">
      <video
        ref={videoRef}
        src={streamUrl}
        controls
        autoPlay
        onError={handleError}
        className="w-full aspect-video bg-black"
      />
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-7 h-7 rounded-md bg-black/60 text-white/70 hover:text-white flex items-center justify-center text-[14px] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ×
      </button>
      <div className="px-3 py-2 bg-[var(--theme-hover)] text-[12px] text-[var(--theme-text-muted)] truncate">
        {filename}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/VideoPlayer.tsx
git commit -m "feat(streaming): add VideoPlayer component with error fallback"
```

---

## Task 6: Make SlideOverPanel width dynamic

**Files:**
- Modify: `src/components/SlideOverPanel.tsx`

- [ ] **Step 1: Add optional width prop**

Modify `src/components/SlideOverPanel.tsx` to accept an optional `width` prop:

Change the interface (line 3-7):

```typescript
interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}
```

Update the destructured props (line 9-12):

```typescript
export default function SlideOverPanel({
  open,
  onClose,
  width = 420,
  children,
}: SlideOverPanelProps) {
```

Change the panel's width style (line 38):

```typescript
          width: `${width}px`,
```

Add a transition to the panel's style object for smooth widening:

```typescript
          transition: "width 0.25s ease",
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/SlideOverPanel.tsx
git commit -m "feat(streaming): add dynamic width prop to SlideOverPanel"
```

---

## Task 7: Integrate streaming into TorrentsPage

**Files:**
- Modify: `src/pages/TorrentsPage.tsx`

This is the largest task. It adds: streaming state, play buttons on file rows, VideoPlayer mounting, panel widening, and session cleanup.

- [ ] **Step 1: Add imports**

At the top of `src/pages/TorrentsPage.tsx`, add:

```typescript
import VideoPlayer from "../components/VideoPlayer";
import { getStreamUrl, cleanupStreamSession } from "../api/streaming";
import { openUrl } from "@tauri-apps/plugin-opener";
```

- [ ] **Step 2: Add streaming state**

Inside the component function, after the existing state declarations, add:

```typescript
  // Streaming state
  const [streamingFileId, setStreamingFileId] = useState<number | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
```

- [ ] **Step 3: Add file type helper functions**

After the streaming state, add:

```typescript
  const INLINE_VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v"];
  const EXTERNAL_VIDEO_EXTS = [".mkv", ".avi", ".wmv", ".flv", ".ts"];

  const getFileExt = (path: string) => {
    const dot = path.lastIndexOf(".");
    return dot >= 0 ? path.slice(dot).toLowerCase() : "";
  };

  const isInlineVideo = (path: string) => INLINE_VIDEO_EXTS.includes(getFileExt(path));
  const isExternalVideo = (path: string) => EXTERNAL_VIDEO_EXTS.includes(getFileExt(path));
  const isVideo = (path: string) => isInlineVideo(path) || isExternalVideo(path);
```

- [ ] **Step 4: Add streaming handler functions**

After the helper functions, add:

```typescript
  const handlePlayInline = async (fileId: number) => {
    if (!detailInfo) return;

    // Toggle off if clicking the same file
    if (streamingFileId === fileId) {
      await handleStopStream();
      return;
    }

    // Cleanup previous session
    if (streamSessionId) {
      await cleanupStreamSession(streamSessionId).catch(() => {});
    }

    setStreamLoading(true);
    setStreamError(null);
    setStreamingFileId(fileId);

    try {
      const result = await getStreamUrl(detailInfo.id, fileId);
      setStreamUrl(result.stream_url);
      setStreamSessionId(result.session_id);
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
      setStreamingFileId(null);
    } finally {
      setStreamLoading(false);
    }
  };

  const handlePlayExternal = async (fileId: number) => {
    if (!detailInfo) return;
    try {
      const result = await getStreamUrl(detailInfo.id, fileId);
      await openUrl(result.stream_url);
      // Cleanup session after a delay (external player will have started loading)
      setTimeout(() => cleanupStreamSession(result.session_id).catch(() => {}), 5000);
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopStream = async () => {
    if (streamSessionId) {
      await cleanupStreamSession(streamSessionId).catch(() => {});
    }
    setStreamingFileId(null);
    setStreamUrl(null);
    setStreamSessionId(null);
    setStreamError(null);
  };
```

- [ ] **Step 5: Add cleanup on slide-over close**

Find the existing `setSelectedId(null)` calls used to close the slide-over. Wrap them to also clean up streaming. Replace the `onClose` of the SlideOverPanel (line 332):

Change:
```tsx
<SlideOverPanel open={!!selectedId} onClose={() => setSelectedId(null)}>
```

To:
```tsx
<SlideOverPanel
  open={!!selectedId}
  onClose={() => { handleStopStream(); setSelectedId(null); }}
  width={streamingFileId !== null ? 640 : 420}
>
```

- [ ] **Step 6: Add VideoPlayer above the file list**

In the slide-over body section, add the VideoPlayer between the info grid (ends ~line 380) and the Files section (starts ~line 383). Insert:

```tsx
              {/* Video Player */}
              {streamingFileId !== null && streamUrl && (
                <VideoPlayer
                  streamUrl={streamUrl}
                  filename={
                    detailInfo.files.find((f) => f.id === streamingFileId)?.path.split("/").pop() || "Video"
                  }
                  onClose={handleStopStream}
                  onExternalPlayer={() => {
                    handleStopStream();
                    handlePlayExternal(streamingFileId);
                  }}
                />
              )}

              {streamError && !streamUrl && (
                <div className="mx-0 mt-5 rounded-[10px] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] p-4 flex items-center justify-between">
                  <p className="text-[13px] text-[#ef4444]">{streamError}</p>
                  <button
                    onClick={() => streamingFileId !== null && handlePlayInline(streamingFileId)}
                    className="text-[12px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] px-3 py-1.5 rounded-md"
                    style={{ background: "var(--theme-hover)" }}
                  >
                    Retry
                  </button>
                </div>
              )}
```

- [ ] **Step 7: Add play buttons to file rows**

Replace the file list items (lines 389-413). Each file row needs a play button when the torrent is downloaded and the file is a video. Replace the existing `<label>` element for each file with:

```tsx
                      <div
                        key={file.id}
                        className={`flex items-center gap-2.5 px-3.5 py-3 border-b border-[var(--theme-border-subtle)] last:border-b-0 transition-colors ${
                          streamingFileId === file.id
                            ? "bg-[rgba(16,185,129,0.06)] border-l-2 border-l-[var(--accent)]"
                            : "hover:bg-[var(--theme-hover)]"
                        }`}
                      >
                        {detailInfo.status === "waiting_files_selection" && (
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(file.id)}
                            onChange={() => {
                              setSelectedFiles((prev) => {
                                const next = new Set(prev);
                                if (next.has(file.id)) next.delete(file.id);
                                else next.add(file.id);
                                return next;
                              });
                            }}
                            className="accent-[#10b981]"
                          />
                        )}

                        {detailInfo.status === "downloaded" && isInlineVideo(file.path) && (
                          <button
                            onClick={() => handlePlayInline(file.id)}
                            disabled={streamLoading && streamingFileId === file.id}
                            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                              streamingFileId === file.id
                                ? "bg-[var(--accent)] text-white"
                                : "bg-[rgba(16,185,129,0.1)] text-[#10b981] hover:bg-[rgba(16,185,129,0.2)]"
                            }`}
                          >
                            {streamLoading && streamingFileId === file.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            ) : streamingFileId === file.id ? (
                              <span className="text-[11px]">■</span>
                            ) : (
                              <span className="text-[11px]">▶</span>
                            )}
                          </button>
                        )}

                        {detailInfo.status === "downloaded" && isExternalVideo(file.path) && (
                          <button
                            onClick={() => handlePlayExternal(file.id)}
                            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--theme-hover)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
                            title="Open in external player"
                          >
                            <span className="text-[11px]">▶↗</span>
                          </button>
                        )}

                        <span className="flex-1 text-[14px] text-[var(--theme-text-primary)] truncate min-w-0">
                          {file.path.startsWith("/") ? file.path.slice(1) : file.path}
                        </span>
                        <span className="text-[12px] text-[var(--theme-text-muted)] shrink-0">
                          {formatBytes(file.bytes)}
                        </span>
                      </div>
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/pages/TorrentsPage.tsx
git commit -m "feat(streaming): integrate inline video player into torrent detail panel"
```

---

## Task 8: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npm run tauri dev`

- [ ] **Step 2: Verify app launches without errors**

Check the terminal for Rust compilation and startup. Confirm: no panics, streaming proxy log message appears ("Streaming proxy started on 127.0.0.1:XXXXX").

- [ ] **Step 3: Test the happy path**

1. Log in with RD API token
2. Navigate to Torrents page
3. Click a torrent that has status "downloaded"
4. Verify: video files (.mp4, .webm) show green play buttons; .mkv/.avi show grey buttons; non-video files show no button
5. Click play on an .mp4 file
6. Verify: slide-over widens, video player appears, video starts streaming
7. Click play on the same file again → player closes, panel narrows back
8. Click play on a different video file → player swaps

- [ ] **Step 4: Test external player fallback**

1. Click the grey external button on an .mkv file
2. Verify: system default video app opens with the stream

- [ ] **Step 5: Test error handling**

1. Close the slide-over while a video is playing → verify no console errors
2. Click play on a torrent that's still processing → verify no play buttons appear

- [ ] **Step 6: Commit any fixes needed**

If any issues found during testing, fix and commit:

```bash
git add -A
git commit -m "fix(streaming): address issues found during integration testing"
```
