# Symlink Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a symlink mode that creates symbolic links from a media library folder to files on an rclone-mounted debrid service, enabling instant Plex/Jellyfin availability with zero data transfer.

**Architecture:** Three new settings fields (`symlink_mode`, `symlink_mount_path`, `symlink_library_path`), a symlink creation path in `start_downloads` that bypasses the download engine entirely, and frontend UI for the toggle + path configuration.

**Tech Stack:** Rust (`tokio::fs::symlink`, `PathBuf`), React/TypeScript (Tailwind), Tauri IPC

**Spec:** `docs/superpowers/specs/2026-03-23-symlink-mode-design.md`

**Note:** No test infrastructure exists. Verify with `cargo check`, `npm run build`, and manual testing.

---

## File Structure

### Modified Files
- `src-tauri/src/state.rs` — Add 3 symlink fields to `AppSettings`
- `src-tauri/src/commands/downloads.rs` — Add symlink creation path in `start_downloads`
- `src/types/index.ts` — Add symlink fields to `AppSettings` TypeScript interface
- `src/pages/SettingsPage.tsx` — Add Symlink Mode section with toggle + path inputs
- `src/pages/DownloadsPage.tsx` — Add link icon for symlinked tasks
- `src/pages/CompletedPage.tsx` — Add link icon for symlinked tasks
- `src/pages/TorrentsPage.tsx` — Skip folder picker when symlink mode is active

---

## Task 1: Backend Settings + Symlink Creation

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/downloads.rs`

- [ ] **Step 1: Add symlink fields to `AppSettings` in `state.rs`**

Add three new fields to the `AppSettings` struct, all with `#[serde(default)]`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_folder: Option<String>,
    pub max_concurrent_downloads: u32,
    pub create_torrent_subfolders: bool,
    pub theme: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub symlink_mode: bool,
    #[serde(default)]
    pub symlink_mount_path: Option<String>,
    #[serde(default)]
    pub symlink_library_path: Option<String>,
}
```

And update the `Default` impl:

```rust
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_folder: None,
            max_concurrent_downloads: 3,
            create_torrent_subfolders: true,
            theme: "dark".to_string(),
            provider: default_provider(),
            symlink_mode: false,
            symlink_mount_path: None,
            symlink_library_path: None,
        }
    }
}
```

- [ ] **Step 2: Add symlink creation path to `start_downloads` in `commands/downloads.rs`**

Read the symlink settings alongside existing settings at the top of `start_downloads`. Replace the current settings read block:

```rust
    let settings = state.settings.read().await;
    let create_subfolders = settings.create_torrent_subfolders;
    let max_concurrent = settings.max_concurrent_downloads as usize;
    drop(settings);
```

With:

```rust
    let settings = state.settings.read().await;
    let create_subfolders = settings.create_torrent_subfolders;
    let max_concurrent = settings.max_concurrent_downloads as usize;
    let symlink_mode = settings.symlink_mode;
    let symlink_mount_path = settings.symlink_mount_path.clone();
    let symlink_library_path = settings.symlink_library_path.clone();
    drop(settings);

    // Symlink mode: create symlinks instead of downloading
    if symlink_mode {
        let mount_path = symlink_mount_path
            .ok_or_else(|| "Symlink mode is on but no mount path configured".to_string())?;
        let library_path = symlink_library_path
            .ok_or_else(|| "Symlink mode is on but no library folder configured".to_string())?;

        // Verify mount path exists
        if !tokio::fs::try_exists(&mount_path).await.unwrap_or(false) {
            return Err("Mount path not found — is your rclone mount running?".to_string());
        }

        let mut task_ids = Vec::new();

        for link in &links {
            let id = uuid::Uuid::new_v4().to_string();

            // Source: file on the rclone mount
            let source = if create_subfolders {
                if let Some(ref name) = torrent_name {
                    PathBuf::from(&mount_path)
                        .join(sanitize_filename(name))
                        .join(sanitize_filename(&link.filename))
                } else {
                    PathBuf::from(&mount_path).join(sanitize_filename(&link.filename))
                }
            } else {
                PathBuf::from(&mount_path).join(sanitize_filename(&link.filename))
            };

            // Destination: symlink in the library folder
            let dest = if create_subfolders {
                if let Some(ref name) = torrent_name {
                    PathBuf::from(&library_path)
                        .join(sanitize_filename(name))
                        .join(sanitize_filename(&link.filename))
                } else {
                    PathBuf::from(&library_path).join(sanitize_filename(&link.filename))
                }
            } else {
                PathBuf::from(&library_path).join(sanitize_filename(&link.filename))
            };

            // Create parent directories
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await
                    .map_err(|e| format!("Failed to create library directory: {}", e))?;
            }

            // Verify source file exists on the mount
            if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
                return Err(format!(
                    "File not found on mount: {} — torrent may still be processing",
                    source.display()
                ));
            }

            // Remove existing symlink if present
            if tokio::fs::symlink_metadata(&dest).await.is_ok() {
                let _ = tokio::fs::remove_file(&dest).await;
            }

            // Create symlink
            #[cfg(unix)]
            tokio::fs::symlink(&source, &dest).await
                .map_err(|e| format!("Failed to create symlink: {}", e))?;

            let task = DownloadTask {
                id: id.clone(),
                filename: link.filename.clone(),
                url: link.download.clone(),
                destination: dest.to_string_lossy().to_string(),
                total_bytes: link.filesize,
                downloaded_bytes: link.filesize, // Instant completion
                speed: 0.0,
                status: DownloadStatus::Completed,
                remote: Some("symlink".to_string()),
            };

            state.active_downloads.write().await.insert(id.clone(), task.clone());

            // Emit completion event
            let progress = crate::downloader::DownloadProgress {
                id: id.clone(),
                filename: task.filename.clone(),
                downloaded_bytes: task.total_bytes,
                total_bytes: task.total_bytes,
                speed: 0.0,
                status: DownloadStatus::Completed,
                remote: Some("symlink".to_string()),
            };
            let _ = app.emit("download-progress", &progress);

            task_ids.push(id);
        }

        return Ok(task_ids);
    }
```

This entire block goes BEFORE the existing `let mut task_ids = Vec::new();` line (the one for normal downloads). It's an early return — if symlink mode is on, we handle everything and return, never reaching the download engine.

Update the import at the top of the file. Change:

```rust
use tauri::{AppHandle, State};
```

to:

```rust
use tauri::{AppHandle, Emitter, State};
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/downloads.rs
git commit -m "feat(symlink): add symlink mode settings and creation path in start_downloads"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add symlink fields to `AppSettings` interface**

Current:
```typescript
export interface AppSettings {
  download_folder: string | null;
  max_concurrent_downloads: number;
  create_torrent_subfolders: boolean;
  theme: string;
  provider: string;
}
```

Replace with:
```typescript
export interface AppSettings {
  download_folder: string | null;
  max_concurrent_downloads: number;
  create_torrent_subfolders: boolean;
  theme: string;
  provider: string;
  symlink_mode?: boolean;
  symlink_mount_path?: string | null;
  symlink_library_path?: string | null;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Compiles cleanly

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(symlink): add symlink fields to AppSettings TypeScript interface"
```

---

## Task 3: Settings Page — Symlink Mode Section

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Read the current SettingsPage.tsx**

Read the file to find:
- The "Remote Downloads" section (rclone) — the symlink section goes after it
- The `ToggleRow` component at the bottom — reuse it for the symlink toggle
- The `applyChange` function — use it to save settings
- The `handleBrowse` pattern — replicate for mount/library path pickers
- The `accentColor` variable — use for consistent styling

- [ ] **Step 2: Add symlink state and browse handlers**

Inside the component, after the existing `pathInput`/`pathError` state, add:

```typescript
const [mountPath, setMountPath] = useState("");
const [libraryPath, setLibraryPath] = useState("");
```

In the useEffect that loads settings, after `setPathInput(s.download_folder ?? "")`, add:
```typescript
setMountPath(s.symlink_mount_path ?? "");
setLibraryPath(s.symlink_library_path ?? "");
```

Add browse handlers after the existing `handleBrowse`:
```typescript
async function handleBrowseMount() {
    const selected = await open({ directory: true, title: "Select mount path" });
    if (selected && typeof selected === "string") {
      setMountPath(selected);
      await applyChange({ symlink_mount_path: selected });
      markSaved("symlink_mount_path");
    }
  }

  async function handleBrowseLibrary() {
    const selected = await open({ directory: true, title: "Select library folder" });
    if (selected && typeof selected === "string") {
      setLibraryPath(selected);
      await applyChange({ symlink_library_path: selected });
      markSaved("symlink_library_path");
    }
  }
```

- [ ] **Step 3: Add Symlink Mode section**

After the Remote Downloads `</section>` and before the Trackers `<section>`, add:

```tsx
            {/* ── Symlink Mode ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Symlink Mode
              </h3>

              <ToggleRow
                label="Create symlinks instead of downloading"
                description="Link files from your debrid mount to your media library — zero transfer, instant availability"
                checked={settings.symlink_mode ?? false}
                saved={savedField === "symlink_mode"}
                accentColor={accentColor}
                onChange={async (v) => {
                  await applyChange({ symlink_mode: v });
                  markSaved("symlink_mode");
                }}
              />

              {settings.symlink_mode && (
                <>
                  {/* Mount Path */}
                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Mount Path</span>
                      {savedField === "symlink_mount_path" && (
                        <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                      )}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                      Where your debrid files appear on the rclone mount
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={mountPath}
                        onChange={(e) => {
                          setMountPath(e.target.value);
                          applyChange({ symlink_mount_path: e.target.value || null });
                        }}
                        placeholder="/Volumes/realdebrid/torrents"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button
                        onClick={handleBrowseMount}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* Library Folder */}
                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Library Folder</span>
                      {savedField === "symlink_library_path" && (
                        <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                      )}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                      Where Plex/Jellyfin scans for media
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={libraryPath}
                        onChange={(e) => {
                          setLibraryPath(e.target.value);
                          applyChange({ symlink_library_path: e.target.value || null });
                        }}
                        placeholder="/media/Movies"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button
                        onClick={handleBrowseLibrary}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* Warning if paths not set */}
                  {(!mountPath || !libraryPath) && (
                    <div className="p-4 rounded-xl mb-12" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                      <p className="text-[13px] text-[#f59e0b]">
                        Both mount path and library folder must be configured for symlink mode to work
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(symlink): add Symlink Mode section to Settings with toggle and path inputs"
```

---

## Task 4: Frontend Icons + Download Flow

**Files:**
- Modify: `src/pages/DownloadsPage.tsx`
- Modify: `src/pages/CompletedPage.tsx`
- Modify: `src/pages/TorrentsPage.tsx`

- [ ] **Step 1: Add link icon to DownloadsPage.tsx**

In the filename column render, find where the cloud icon is shown for `t.remote`. After the cloud icon SVG block, add a symlink icon case:

```tsx
{t.remote === "symlink" && (
  <svg
    className="w-3.5 h-3.5 shrink-0 text-[var(--theme-text-muted)]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>Symlinked</title>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)}
```

Update the existing cloud icon condition from `{t.remote && (` to `{t.remote && t.remote !== "symlink" && (` so they don't both show.

- [ ] **Step 2: Add link icon to CompletedPage.tsx**

Same pattern — in the filename render, find the cloud icon block and add the symlink case. Update cloud condition to exclude "symlink".

Also fix the Reveal button: the current condition is `{t.destination && !t.remote && (` which hides Reveal for ALL remote tasks. Symlinks ARE local filesystem paths, so Reveal should work. Change the condition to:

```tsx
{t.destination && (!t.remote || t.remote === "symlink") && (
```

- [ ] **Step 3: Modify TorrentsPage.tsx download flow**

In both `handleDownloadTorrent` and `handleDetailDownload`, the download flow needs to skip the folder picker when symlink mode is active (the backend uses `symlink_library_path` from settings).

In `handleDownloadTorrent`, replace the folder logic:

```typescript
      // Symlink mode: backend uses library path from settings, no folder needed
      let folder = settings?.download_folder ?? null;
      if (settings?.symlink_mode) {
        if (!settings?.symlink_mount_path || !settings?.symlink_library_path) {
          setError("Symlink mode is on but mount path or library folder is not configured. Check Settings.");
          return;
        }
        folder = settings.symlink_library_path; // Backend will override, but we need a non-null value
      } else if (!folder) {
        const picked = await open({ directory: true, title: "Select download folder" });
        if (!picked) return;
        folder = picked as string;
      }
```

In `handleDetailDownload`, same change but using `s` instead of `settings`:

```typescript
      const s = await getSettings();
      let folder = s.download_folder;
      if (s.symlink_mode) {
        if (!s.symlink_mount_path || !s.symlink_library_path) {
          setDetailError("Symlink mode is on but mount path or library folder is not configured. Check Settings.");
          return;
        }
        folder = s.symlink_library_path;
      } else if (!folder) {
        const picked = await open({ directory: true, title: "Select download folder" });
        if (!picked) { setDownloading(false); return; }
        folder = picked as string;
      }
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add src/pages/DownloadsPage.tsx src/pages/CompletedPage.tsx src/pages/TorrentsPage.tsx
git commit -m "feat(symlink): add link icons and skip folder picker in symlink mode"
```

---

## Task 5: Integration Verification

- [ ] **Step 1: Full build check**

Run: `cd src-tauri && cargo check && cd .. && npm run build`
Expected: Both pass

- [ ] **Step 2: Manual test — symlink mode OFF**

1. Ensure symlink mode is off in Settings
2. Download a torrent normally
3. Verify it downloads to the configured folder as before (no regression)

- [ ] **Step 3: Manual test — symlink mode ON**

1. Enable symlink mode in Settings
2. Set mount path to where your debrid mount is (e.g. testremote path or real mount)
3. Set library path to a test folder (e.g. `/tmp/test-library`)
4. Download a torrent
5. Verify: symlink appears in library folder, points to mount path, shows link icon, Reveal button works

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "feat(symlink): integration testing polish"
```
