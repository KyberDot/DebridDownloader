# Preview Video Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click preview button to the torrent list that opens a floating, draggable, resizable mini video player.

**Architecture:** New `MiniPlayerContext` at the app root manages stream state. A `MiniPlayer` component renders a floating HTML5 `<video>` with pointer-event-based drag/resize. The preview button on each torrent row calls `openPreview(torrentId)` which fetches torrent info, picks the largest video file, and streams via the existing Rust backend.

**Tech Stack:** React Context, HTML5 `<video>`, pointer events, existing Tauri streaming commands (`get_stream_url`, `cleanup_stream_session`), `@tauri-apps/plugin-opener` for external player fallback.

**Spec:** `docs/superpowers/specs/2026-03-21-preview-video-button-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/contexts/MiniPlayerContext.tsx` | Create | Context provider, state, actions (`openPreview`, `closePreview`), `useMiniPlayer` hook |
| `src/components/MiniPlayer.tsx` | Create | Floating draggable/resizable video player with fallback UI |
| `src/components/Toast.tsx` | Create | Lightweight temporary notification component (app has no toast system) |
| `src/App.tsx` | Modify | Wrap with `MiniPlayerProvider`, render `<MiniPlayer />` at root level |
| `src/pages/TorrentsPage.tsx` | Modify | Add preview button to torrent row actions column |

---

### Task 1: Toast Component

The app has no toast/notification system. The mini-player needs one for "Not available for streaming yet" and "No video files found" messages. Build a minimal one.

**Files:**
- Create: `src/components/Toast.tsx`

- [ ] **Step 1: Create Toast component**

Create `src/components/Toast.tsx` — a simple fixed-position notification that auto-dismisses:

```tsx
import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, onDismiss, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200); // Wait for exit animation
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className="fixed bottom-6 z-[200] px-5 py-3 rounded-xl text-[14px] font-medium shadow-lg transition-all duration-200"
      style={{
        left: "50%",
        background: "var(--theme-bg-surface)",
        color: "var(--theme-text-primary)",
        border: "1px solid var(--theme-border)",
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? "0" : "12px"})`,
      }}
    >
      {message}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Toast.tsx
git commit -m "feat: add lightweight Toast notification component"
```

---

### Task 2: MiniPlayerContext

The context manages all stream state and exposes `openPreview`/`closePreview` actions.

**Files:**
- Create: `src/contexts/MiniPlayerContext.tsx`
- Reference: `src/api/torrents.ts` — `getTorrentInfo()`
- Reference: `src/api/streaming.ts` — `getStreamUrl()`, `cleanupStreamSession()`
- Reference: `src/types/index.ts` — `TorrentFile`, `StreamUrlResponse`

- [ ] **Step 1: Create MiniPlayerContext**

Create `src/contexts/MiniPlayerContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { getTorrentInfo } from "../api/torrents";
import { getStreamUrl, cleanupStreamSession } from "../api/streaming";

const INLINE_PLAYABLE_EXTS = [".mp4", ".webm", ".mov", ".m4v"];
const ALL_VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".flv", ".ts"];

function getFileExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

interface MiniPlayerState {
  isOpen: boolean;
  streamUrl: string | null;
  sessionId: string | null;
  filename: string;
  isLoading: boolean;
  torrentId: string | null;
  fileId: number | null;
  isInlinePlayable: boolean;
  toastMessage: string | null;
}

interface MiniPlayerActions {
  openPreview: (torrentId: string, fileId?: number, filename?: string) => Promise<void>;
  closePreview: () => Promise<void>;
  retryPreview: () => Promise<void>;
  dismissToast: () => void;
}

type MiniPlayerContextValue = MiniPlayerState & MiniPlayerActions;

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);

const initialState: MiniPlayerState = {
  isOpen: false,
  streamUrl: null,
  sessionId: null,
  filename: "",
  isLoading: false,
  torrentId: null,
  fileId: null,
  isInlinePlayable: true,
  toastMessage: null,
};

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MiniPlayerState>(initialState);

  // Refs to avoid stale closures in async callbacks
  const sessionIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const torrentIdRef = useRef<string | null>(null);
  const fileIdRef = useRef<number | null>(null);

  // Keep refs in sync with state
  sessionIdRef.current = state.sessionId;
  torrentIdRef.current = state.torrentId;
  fileIdRef.current = state.fileId;
  loadingRef.current = state.isLoading;

  const cleanupSession = useCallback(async (sid: string | null) => {
    if (sid) {
      await cleanupStreamSession(sid).catch(() => {});
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setState((s) => ({ ...s, toastMessage: message }));
  }, []);

  const dismissToast = useCallback(() => {
    setState((s) => ({ ...s, toastMessage: null }));
  }, []);

  const openPreview = useCallback(
    async (torrentId: string, fileId?: number, filename?: string) => {
      // Prevent duplicate requests using ref for immediate check
      if (loadingRef.current) return;
      setState((s) => ({ ...s, isLoading: true }));

      try {
        // Cleanup any existing session using ref for current value
        await cleanupSession(sessionIdRef.current);

        let targetFileId = fileId;
        let targetFilename = filename;
        let inlinePlayable = true;

        // If no fileId provided, fetch torrent info and pick the largest video file
        if (targetFileId === undefined) {
          const info = await getTorrentInfo(torrentId);
          const videoFiles = info.files.filter((f) =>
            ALL_VIDEO_EXTS.includes(getFileExt(f.path))
          );

          if (videoFiles.length === 0) {
            showToast("No video files found");
            setState((s) => ({ ...s, isLoading: false }));
            return;
          }

          const largest = videoFiles.reduce((a, b) => (b.bytes > a.bytes ? b : a));
          targetFileId = largest.id;
          targetFilename = largest.path.split("/").pop() || largest.path;
          inlinePlayable = INLINE_PLAYABLE_EXTS.includes(getFileExt(largest.path));
        } else if (targetFilename) {
          inlinePlayable = INLINE_PLAYABLE_EXTS.includes(getFileExt(targetFilename));
        }

        // Get stream URL — targetFileId is guaranteed to be a number here
        const result = await getStreamUrl(torrentId, targetFileId!);

        setState({
          isOpen: true,
          streamUrl: result.stream_url,
          sessionId: result.session_id,
          filename: targetFilename || "Video",
          isLoading: false,
          torrentId,
          fileId: targetFileId!,
          isInlinePlayable: inlinePlayable,
          toastMessage: null,
        });
      } catch (e) {
        showToast("Not available for streaming yet");
        setState((s) => ({ ...s, isLoading: false }));
      }
    },
    [cleanupSession, showToast]
  );

  const closePreview = useCallback(async () => {
    await cleanupSession(sessionIdRef.current);
    setState(initialState);
  }, [cleanupSession]);

  const retryPreview = useCallback(async () => {
    const tid = torrentIdRef.current;
    const fid = fileIdRef.current;
    if (!tid || fid === null) return;

    await cleanupSession(sessionIdRef.current);
    setState((s) => ({ ...s, isLoading: true, streamUrl: null }));

    try {
      const result = await getStreamUrl(tid, fid);
      setState((s) => ({
        ...s,
        streamUrl: result.stream_url,
        sessionId: result.session_id,
        isLoading: false,
      }));
    } catch {
      showToast("Still not available for streaming");
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [cleanupSession, showToast]);

  const value: MiniPlayerContextValue = {
    ...state,
    openPreview,
    closePreview,
    retryPreview,
    dismissToast,
  };

  return (
    <MiniPlayerContext.Provider value={value}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer(): MiniPlayerContextValue {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error("useMiniPlayer must be used within MiniPlayerProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run build`
Expected: No errors (context is created but not mounted yet)

- [ ] **Step 3: Commit**

```bash
git add src/contexts/MiniPlayerContext.tsx
git commit -m "feat: add MiniPlayerContext for floating video preview state"
```

---

### Task 3: MiniPlayer Component

The floating, draggable, resizable video player.

**Files:**
- Create: `src/components/MiniPlayer.tsx`
- Reference: `src/contexts/MiniPlayerContext.tsx` — `useMiniPlayer()`
- Reference: `@tauri-apps/plugin-opener` — `open()` for external player

- [ ] **Step 1: Create MiniPlayer component**

Create `src/components/MiniPlayer.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
import { openUrl } from "@tauri-apps/plugin-opener";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 250;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const EDGE_PADDING = 16;

export default function MiniPlayer() {
  const {
    isOpen,
    streamUrl,
    filename,
    isLoading,
    isInlinePlayable,
    closePreview,
    retryPreview,
  } = useMiniPlayer();

  // Position & size — component-local state
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const [videoError, setVideoError] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);

  // Initialize position to bottom-right when first opened
  useEffect(() => {
    if (isOpen && !initialized) {
      setPos({
        x: window.innerWidth - DEFAULT_WIDTH - EDGE_PADDING,
        y: window.innerHeight - DEFAULT_HEIGHT - EDGE_PADDING,
      });
      setSize({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
      setVideoError(false);
      setInitialized(true);
    }
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, initialized]);

  // Reset video error when stream URL changes
  useEffect(() => {
    setVideoError(false);
  }, [streamUrl]);

  // Clamp position on window resize
  useEffect(() => {
    const handleResize = () => {
      setPos((p) => ({
        x: Math.min(p.x, Math.max(0, window.innerWidth - size.w - EDGE_PADDING)),
        y: Math.min(p.y, Math.max(0, window.innerHeight - size.h - EDGE_PADDING)),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [size.w, size.h]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, closePreview]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - size.w, dragRef.current.origX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - size.h, dragRef.current.origY + dy)),
    });
  }, [size.w, size.h]);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Resize handlers (bottom-left corner: dragging left increases width, dragging down increases height)
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: size.w,
      origH: size.h,
      origX: pos.x,
      origY: pos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size.w, size.h, pos.x, pos.y]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;

    // Bottom-left: drag left = wider (negative dx = more width), drag down = taller
    const newW = Math.max(MIN_WIDTH, resizeRef.current.origW - dx);
    const newH = Math.max(MIN_HEIGHT, resizeRef.current.origH + dy);
    const newX = resizeRef.current.origX + (resizeRef.current.origW - newW);

    setSize({ w: newW, h: newH });
    setPos((p) => ({ x: Math.max(0, newX), y: p.y }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null;
  }, []);

  const handleExternalPlayer = useCallback(async () => {
    if (streamUrl) {
      await openUrl(streamUrl);
    }
  }, [streamUrl]);

  if (!isOpen) return null;

  const showFallback = !isInlinePlayable || videoError;

  return (
    <div
      ref={containerRef}
      className="fixed rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 100,
        border: "1px solid var(--theme-border)",
        background: "#000",
      }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
        style={{ background: "rgba(0,0,0,0.85)" }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <span className="text-[12px] text-white/70 truncate mr-2">{filename}</span>
        <button
          onClick={(e) => { e.stopPropagation(); closePreview(); }}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 relative min-h-0">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : showFallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black gap-3 px-4">
            <p className="text-[13px] text-white/60 text-center">
              {videoError ? "Playback failed" : "Format not supported in browser"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleExternalPlayer}
                className="px-4 py-2 rounded-lg text-[12px] font-medium text-white transition-colors cursor-pointer"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
              >
                Open in External Player
              </button>
              {videoError && (
                <button
                  onClick={() => retryPreview()}
                  className="px-4 py-2 rounded-lg text-[12px] text-white/60 hover:text-white transition-colors cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.1)" }}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ) : streamUrl ? (
          <video
            src={streamUrl}
            controls
            autoPlay
            onError={() => setVideoError(true)}
            className="w-full h-full object-contain bg-black"
          />
        ) : null}
      </div>

      {/* Resize handle — bottom-left corner */}
      <div
        className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize"
        style={{ zIndex: 10 }}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 left-1 text-white/30">
          <line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" strokeWidth="1" />
          <line x1="0" y1="6" x2="6" y2="0" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run build`
Expected: No errors (component exists but isn't mounted yet)

- [ ] **Step 3: Commit**

```bash
git add src/components/MiniPlayer.tsx
git commit -m "feat: add floating MiniPlayer component with drag/resize"
```

---

### Task 4: Wire Up App.tsx

Mount the context provider and MiniPlayer + Toast at the app root.

**Files:**
- Modify: `src/App.tsx`
- Reference: `src/contexts/MiniPlayerContext.tsx`
- Reference: `src/components/MiniPlayer.tsx`
- Reference: `src/components/Toast.tsx`

- [ ] **Step 1: Add imports to App.tsx**

At the top of `src/App.tsx`, add after the existing imports:

```tsx
import { MiniPlayerProvider, useMiniPlayer } from "./contexts/MiniPlayerContext";
import MiniPlayer from "./components/MiniPlayer";
import Toast from "./components/Toast";
```

- [ ] **Step 2: Create a MiniPlayerToast helper component**

Add inside `App.tsx`, before the `App` function:

```tsx
function MiniPlayerToast() {
  const { toastMessage, dismissToast } = useMiniPlayer();
  if (!toastMessage) return null;
  return <Toast message={toastMessage} onDismiss={dismissToast} />;
}
```

- [ ] **Step 3: Wrap the app with MiniPlayerProvider**

In the `App` function's return, wrap the `AuthContext.Provider` with `MiniPlayerProvider` and add `<MiniPlayer />` and `<MiniPlayerToast />` inside it.

Change the return from:

```tsx
  return (
    <AuthContext.Provider value={authState}>
      <BrowserRouter>
```

To:

```tsx
  return (
    <MiniPlayerProvider>
      <AuthContext.Provider value={authState}>
        <BrowserRouter>
```

And change the closing from:

```tsx
      </BrowserRouter>
    </AuthContext.Provider>
  );
```

To:

```tsx
        </BrowserRouter>
        <MiniPlayer />
        <MiniPlayerToast />
      </AuthContext.Provider>
    </MiniPlayerProvider>
  );
```

Note: `MiniPlayerProvider` wraps everything so the context is available everywhere. `MiniPlayer` and `MiniPlayerToast` are inside `MiniPlayerProvider` but outside `BrowserRouter` so they persist across page navigation. They render unconditionally in the DOM, but this is harmless — the player only opens when `openPreview` is called, which only happens from authenticated pages.

- [ ] **Step 4: Verify frontend compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount MiniPlayerProvider and floating player at app root"
```

---

### Task 5: Add Preview Button to TorrentsPage

Add a play/preview button to each torrent row's actions column.

**Files:**
- Modify: `src/pages/TorrentsPage.tsx`
- Reference: `src/contexts/MiniPlayerContext.tsx` — `useMiniPlayer()`

- [ ] **Step 1: Add import**

At the top of `src/pages/TorrentsPage.tsx`, add:

```tsx
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
```

- [ ] **Step 2: Use the hook inside the component**

Inside the `TorrentsPage` function, after the existing state declarations (around line 79, after the streaming state block), add:

```tsx
const { openPreview, isLoading: miniPlayerLoading } = useMiniPlayer();
```

- [ ] **Step 3: Add preview button to the actions column**

In the `columns` array, inside the `actions` column `render` function (the `<div className="flex gap-1.5 justify-end">` block), add a preview button **before** the existing download button. Insert this as the first child inside that div:

```tsx
<button
  onClick={() => openPreview(t.id)}
  disabled={miniPlayerLoading}
  className="w-[30px] h-[30px] rounded-md flex items-center justify-center cursor-pointer transition-colors"
  style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6" }}
  title="Preview Video"
>
  {miniPlayerLoading ? (
    <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  )}
</button>
```

- [ ] **Step 4: Also add preview to the context menu**

In the context menu JSX (the `{contextMenu && (` block), add a "Preview" option **before** the "Download" button:

```tsx
<button
  className="w-full text-left px-4 py-2.5 text-[15px] text-[var(--theme-text-primary)] cursor-pointer hover:bg-[var(--theme-selected)] transition-colors"
  onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); openPreview(id); }}
>
  Preview
</button>
```

- [ ] **Step 5: Update context menu height clamp**

The existing context menu clamps its vertical position with `window.innerHeight - 160`. Adding a fourth menu item increases the menu height to ~170px. Update the clamp value in the context menu's `style` prop:

Change:
```tsx
top: Math.min(contextMenu.y, window.innerHeight - 160),
```

To:
```tsx
top: Math.min(contextMenu.y, window.innerHeight - 200),
```

- [ ] **Step 6: Verify frontend compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 7: Manual test**

Run: `npm run tauri dev`

Test the following:
1. Click the purple play button on any torrent row → should either open mini-player (if torrent has video files and is available) or show a toast message
2. Right-click a torrent → "Preview" option should appear in context menu
3. Mini-player should float in bottom-right corner
4. Drag the header bar to reposition
5. Drag the bottom-left corner to resize
6. Press Escape to close
7. Navigate to other pages — mini-player should persist
8. Open a new preview while one is playing — should replace the current one

- [ ] **Step 8: Commit**

```bash
git add src/pages/TorrentsPage.tsx
git commit -m "feat: add preview video button to torrent list rows and context menu"
```

---

### Task 6: Final Adjustments and Cleanup

Verify everything works together, fix any edge cases.

**Files:**
- All files from previous tasks

- [ ] **Step 1: Widen the actions column**

The actions column in `TorrentsPage.tsx` is currently `width: "120px"`. With the new preview button, it needs to be wider. Change:

```tsx
width: "120px",
```

To:

```tsx
width: "155px",
```

- [ ] **Step 2: Verify the slide-over close also stops mini-player if same torrent**

Check that closing the slide-over panel doesn't interfere with the mini-player. The slide-over calls `handleStopStream()` on close, which manages the slide-over's own streaming state — this is separate from the mini-player context, so no conflict. No code change needed here, just verify.

- [ ] **Step 3: Final build check**

Run: `npm run build`
Expected: Clean build, no errors, no warnings

- [ ] **Step 4: Commit any adjustments**

```bash
git add -A
git commit -m "fix: widen actions column for preview button"
```
