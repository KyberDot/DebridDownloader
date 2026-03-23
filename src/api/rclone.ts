import { invoke } from "@tauri-apps/api/core";
import type { RcloneInfo } from "../types";

export async function checkRclone(): Promise<RcloneInfo | null> {
  return invoke("check_rclone");
}

export async function listRcloneRemotes(): Promise<string[]> {
  return invoke("list_rclone_remotes");
}

export async function validateRcloneRemote(
  remoteName: string
): Promise<boolean> {
  return invoke("validate_rclone_remote", { remoteName });
}
