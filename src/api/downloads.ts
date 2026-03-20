import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadItem,
  DownloadTask,
  UnrestrictedLink,
} from "../types";

export async function unrestrictLink(link: string): Promise<UnrestrictedLink> {
  return invoke("unrestrict_link", { link });
}

export async function unrestrictTorrentLinks(
  torrentId: string
): Promise<UnrestrictedLink[]> {
  return invoke("unrestrict_torrent_links", { torrentId });
}

export async function startDownloads(
  links: UnrestrictedLink[],
  destinationFolder: string,
  torrentName?: string
): Promise<string[]> {
  return invoke("start_downloads", {
    links,
    destinationFolder,
    torrentName: torrentName ?? null,
  });
}

export async function cancelDownload(id: string): Promise<void> {
  return invoke("cancel_download", { id });
}

export async function removeDownload(id: string): Promise<void> {
  return invoke("remove_download", { id });
}

export async function cancelAllDownloads(): Promise<void> {
  return invoke("cancel_all_downloads");
}

export async function getDownloadTasks(): Promise<DownloadTask[]> {
  return invoke("get_download_tasks");
}

export async function clearCompletedDownloads(): Promise<void> {
  return invoke("clear_completed_downloads");
}

export async function getDownloadHistory(
  page?: number,
  limit?: number
): Promise<DownloadItem[]> {
  return invoke("get_download_history", {
    page: page ?? null,
    limit: limit ?? null,
  });
}
