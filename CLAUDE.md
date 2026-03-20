# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

DebridDownloader — a Tauri v2 desktop app (macOS + Windows) for managing torrents and downloads via the Real-Debrid API. React frontend talks to a Rust backend through Tauri's `invoke` IPC.

## Commands

```bash
# Dev (starts both Vite dev server and Tauri window)
npm run tauri dev

# TypeScript check (no emit)
npx tsc --noEmit

# Build for production
npm run tauri build

# Frontend only (Vite dev server on :1420)
npm run dev
```

No test framework is configured. No linter is configured.

## Architecture

### Two-process model (Tauri v2)

- **Frontend** (`src/`): React 19 + TypeScript + Tailwind CSS v4 + React Router v7. Communicates with backend exclusively via `invoke()` from `@tauri-apps/api/core`.
- **Backend** (`src-tauri/src/`): Rust. Handles all Real-Debrid API calls, file downloads, token storage (keyring), and settings persistence.

### Backend structure (`src-tauri/src/`)

| Module | Role |
|---|---|
| `lib.rs` | Tauri builder — registers all plugins and commands |
| `state.rs` | `AppState` (managed state): RD client, settings, active downloads, cancel tokens |
| `api/client.rs` | `RdClient` — HTTP client wrapping Real-Debrid REST API |
| `api/torrents.rs`, `api/unrestrict.rs`, `api/downloads.rs` | API endpoint wrappers |
| `commands/` | Tauri `#[command]` functions (auth, torrents, downloads, settings) — bridge between frontend invoke calls and backend logic |
| `downloader.rs` | File download engine with progress tracking and cancellation |

### Frontend structure (`src/`)

| Path | Role |
|---|---|
| `api/` | Thin `invoke()` wrappers — one file per domain (auth, torrents, downloads, settings) |
| `types/index.ts` | All TypeScript interfaces mirroring Rust types |
| `hooks/` | `useAuth` (context + hook), `useDownloadProgress` (polling) |
| `pages/` | Route-level components: Auth, Torrents, Downloads, History, Settings |
| `components/` | Layout (sidebar + outlet), AddTorrentModal, TorrentDetail |
| `styles/index.css` | Tailwind v4 import + custom theme tokens (`rd-green`, `rd-dark`, etc.) |

### Key patterns

- **Auth flow**: Supports both direct API token entry and OAuth device-code flow. Token stored in OS keychain via `keyring` crate.
- **IPC contract**: Every frontend API call maps 1:1 to a Rust `#[tauri::command]`. Adding a new command requires: Rust function in `commands/`, registration in `lib.rs` `generate_handler![]`, and a TS wrapper in `src/api/`.
- **Download management**: Backend tracks active downloads in `AppState.active_downloads` (HashMap behind RwLock). Cancellation uses `tokio::sync::watch` channels stored in `cancel_tokens`.
- **State**: Frontend uses React Context for auth state. No external state management library.

### Tauri plugins in use

`opener`, `dialog`, `fs`, `store` — all v2 plugins registered in `lib.rs`.

## Design System

Custom dark theme with Real-Debrid brand colors defined as Tailwind v4 theme tokens in `src/styles/index.css`. Use `rd-*` color tokens (e.g., `bg-rd-dark`, `text-rd-green`) rather than raw hex values.

## CI

GitHub Actions (`.github/workflows/build.yml`): builds for macOS (arm64 + x64) and Windows (x64). Triggered on version tags (`v*`) for releases, `workflow_dispatch` for build checks. Build checks also run `tsc --noEmit`.
