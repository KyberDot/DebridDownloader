# DebridDownloader UI Redesign

## Overview

Complete UI overhaul replacing the current icon-rail + master-detail layout with a labeled sidebar + full-width sortable table + slide-over detail panel. The goal is a desktop app that feels spacious and readable on large monitors, with proper information hierarchy and efficient use of screen real estate.

## Architecture Changes

### Layout Structure

**Current**: IconRail (48-56px) + MasterDetail (resizable 55/45 split)
**New**: Labeled Sidebar (200px) + Full-width content area

The `MasterDetail` component and `IconRail` component are removed. Replaced by:
- `Sidebar` component (200px fixed width, full height)
- Page-level content components that own the full remaining width
- `SlideOverPanel` component that overlays from the right

### Routing Changes

**Current routes**: `/torrents`, `/downloads`
**New routes**: `/torrents`, `/downloads`, `/completed`

The "Completed" view is a new filtered view showing only downloads with status `Completed`. Settings remains a modal overlay, not a route.

### Data Flow

Both `/downloads` and `/completed` consume the same `getDownloadTasks()` backend command. To avoid duplicate polling, the `Layout` component owns a single polling loop (every 3 seconds) and passes the task list down via React context or props. Each page filters client-side:
- Downloads page: `status !== "Completed"`
- Completed page: `status === "Completed"`

This replaces the per-page polling in the current `DownloadsPage.tsx`.

## Components

### Sidebar

Fixed 200px left panel. Two sections with category headers.

**Library section**:
- Torrents — navigates to `/torrents`
- Downloads — navigates to `/downloads` (active/pending only)
- Completed — navigates to `/completed` (completed downloads only)

**System section**:
- Search — opens CommandPalette (Cmd+K). Provides visual discoverability for the shortcut.
- Settings — opens SettingsModal overlay

**Bottom area**: User avatar, username, premium days remaining. Click opens logout popover (same behavior as current).

**Visual treatment**:
- Background: `#07070d`
- Right border: `1px solid rgba(255,255,255,0.06)`
- Section headers: 11px uppercase tracking-wider `#475569`
- Nav items: 14px with 16px icons, 10px 12px padding, 8px border-radius
- Active item: `rgba(16,185,129,0.08)` background, `#10b981` text
- Inactive items: `#64748b` text

### Page Header / Toolbar

Sits at the top of the content area on every page.

- Left: Page title (22px bold), subtitle with item count + total size (13px muted)
- Right: Inline filter input (240px, search icon, placeholder "Filter torrents...") + "Add" button (emerald gradient)
- The "Add" button only appears on the Torrents page
- Filter input filters the current table by filename (client-side, instant)

### Sortable Table

Full-width table with sticky column headers.

**Torrents page columns**:
| Column | Width | Sortable | Content |
|--------|-------|----------|---------|
| Name | flex (1fr) | Yes | Filename, 15px medium weight |
| Size | 100px | Yes | Formatted bytes, 14px secondary |
| Added | 110px | Yes | Relative time (< 24h: "3 hours ago", < 7d: "2 days ago", >= 7d: "Mar 8, 2026"), 13px muted |
| Status | 100px | No | Status badge pill (Ready, Downloading, Queued, etc.) |
| Actions | 70px | No | Download icon button + overflow menu button |

**Downloads page columns**:
| Column | Width | Sortable | Content |
|--------|-------|----------|---------|
| Name | flex (1fr) | Yes | Filename + progress bar below (when active) |
| Size | 100px | Yes | total_bytes formatted |
| Speed | 100px | No | Current speed (active only), "--" otherwise |
| Status | 100px | No | Status badge or percentage |
| Actions | 70px | No | Cancel button (active) or overflow menu |

**Completed page columns**:
| Column | Width | Sortable | Content |
|--------|-------|----------|---------|
| Name | flex (1fr) | Yes | Filename |
| Size | 100px | Yes | total_bytes formatted |
| Destination | flex (0.5fr) | No | File path, truncated |
| Actions | 70px | No | Overflow menu (reveal in finder, remove) |

**Sort behavior**: Click column header to sort ascending, click again for descending. Sort indicator arrow (↕ neutral, ↑ asc, ↓ desc) shown in header. Default sort: Added descending (newest first) for Torrents, status then recency for Downloads.

**Row behavior**:
- Hover: `rgba(255,255,255,0.02)` background
- Click: Opens slide-over detail panel
- Right-click: Context menu (same options as current)
- Row height: ~56px with 14px vertical padding

**Quick action buttons per row**:
- Download button: 30x30px rounded, emerald tint background, download icon. Only shown on Torrents with status "downloaded".
- Overflow menu (···): 30x30px rounded, subtle background. Opens context menu with: Download, Delete, Copy Magnet (torrents) or Cancel, Remove (downloads).

### SlideOverPanel

Triggered by clicking a table row. Slides in from the right edge.

**Scrim**: `rgba(0,0,0,0.4)` over the table area. Click to close.

**Panel**:
- Width: 420px
- Background: `#0e0e18`
- Left border: `1px solid rgba(255,255,255,0.08)`
- Box shadow: `-8px 0 40px rgba(0,0,0,0.5)`
- Animation: slide in from right, 200ms ease-out

**Panel structure (top to bottom)**:
1. **Header** (sticky): Status badge + title (18px bold, word-break) + close button (X)
2. **Body** (scrollable): Info grid (2x2 cards: Size, Added, Links, Hash) + file list with checkboxes
3. **Footer** (sticky): Action buttons — primary (Download/Select Files, full width emerald gradient) + secondary (Delete, red tint)

**Close triggers**: X button, click scrim, Escape key

**Switching items**: If the slide-over is already open and the user clicks a different row in the table (visible through the scrim), the panel content swaps instantly (no close/re-open animation). The panel stays in place and the body content updates.

### DataTable Column Interface

```typescript
interface Column<T> {
  key: string;
  header: string;
  width: string;           // CSS grid value: "1fr", "100px", etc.
  sortable?: boolean;
  render: (item: T) => ReactNode;
}
```

The `DataTable` component accepts `columns: Column<T>[]`, `data: T[]`, `onRowClick: (item: T) => void`, `onSort: (key: string, direction: 'asc' | 'desc') => void`, and `selectedId?: string`. Sorting state is managed by the parent page component.

### Downloads View Specifics

Active downloads show inline progress in the table row:
- Thin progress bar (3px) below the filename
- Speed column shows live speed
- Status column shows percentage

The slide-over for an active download shows:
- Large percentage display (28px)
- Full-width progress bar (4px)
- Stats grid: Speed, ETA, Downloaded (x of y), Destination
- Cancel button

The slide-over for a completed download shows:
- Checkmark icon + "Download complete" label
- Info cards: Size, Destination (full path, word-break)
- Footer: "Reveal in Finder" button (primary, uses Tauri `opener` plugin) + "Remove" button (removes from task list only, does not delete files — uses existing `clearCompletedDownloads` filtered to single task, or simply hides it client-side)

The slide-over for a failed/cancelled download shows:
- Error status text (red)
- Info cards: Destination (if set), Error message (if Failed)
- Footer: "Remove" button only

### Completed View

Filtered view of downloads where `status === "Completed"`. Same table structure but with Destination column instead of Speed. "Clear All" button in the toolbar (where "Add" would be on torrents page).

**Empty state**: "No completed downloads" with subtitle "Downloads will appear here once they finish."

### Context Menus

**Torrent rows**: Download, Delete, Copy Magnet (same as current)
**Active download rows**: Cancel
**Completed download rows**: Reveal in Finder, Remove (hides from list, does not delete file)
**Failed/cancelled download rows**: Remove

## Preserved Functionality

All existing functionality is preserved:

- **Cmd+K**: Command palette (tracker search + local filter + magnet paste)
- **Cmd+R**: Refresh current view's data
- **Escape**: Close slide-over, close modals, close command palette
- **Delete/Backspace**: Delete selected item (when slide-over is open)
- **Enter**: Download selected item (when slide-over is open)
- **Context menus**: Right-click on table rows
- **Add Torrent Modal**: Same modal, triggered from toolbar "Add" button
- **Settings Modal**: Same modal, triggered from sidebar
- **Auth flow**: AuthPage unchanged

## Components to Create

| Component | Replaces | Purpose |
|-----------|----------|---------|
| `Sidebar.tsx` | `IconRail.tsx` | Labeled navigation sidebar |
| `DataTable.tsx` | inline list rendering | Reusable sortable table with column config |
| `SlideOverPanel.tsx` | `TorrentDetail.tsx` (partial) | Animated right-side overlay panel |
| `TableToolbar.tsx` | inline header rendering | Page title + filter + actions |

## Components to Modify

| Component | Changes |
|-----------|---------|
| `Layout.tsx` | Replace IconRail with Sidebar, remove MasterDetail dependency |
| `TorrentsPage.tsx` | Rewrite to use DataTable + SlideOverPanel instead of MasterDetail |
| `DownloadsPage.tsx` | Rewrite to use DataTable + SlideOverPanel |
| `App.tsx` | Add `/completed` route |

## Components to Remove

| Component | Reason |
|-----------|--------|
| `IconRail.tsx` | Replaced by Sidebar |
| `MasterDetail.tsx` | No longer needed — full-width table layout |
| `StatsDashboard.tsx` | Stats info moves to sidebar (premium days) and page subtitles (counts) |

## Design Tokens

No changes to the color palette. New tokens for the sidebar background:

```css
--color-noir-sidebar: #07070d;
```

Base font size remains 15px. Table text sizes: 15px body, 14px secondary, 13px muted, 12px labels, 11px section headers.

## Animation

- Slide-over: `transform: translateX(100%) → translateX(0)`, 200ms ease-out
- Scrim: `opacity: 0 → 0.4`, 150ms ease
- Sort indicator: instant (no animation needed)
- Row hover: `background-color` transition 150ms

## Out of Scope

- **Multi-select / bulk actions**: Table rows support single selection only. Bulk operations (delete multiple, download multiple) are not part of this redesign. The table structure would support this in the future.
- **Backend changes**: No new Tauri commands. The "Remove" action on completed downloads hides items client-side (or uses existing `clearCompletedDownloads`).
- **Drag-and-drop reordering**: Not needed.
- **Column resizing**: Fixed column widths. Not user-resizable.
