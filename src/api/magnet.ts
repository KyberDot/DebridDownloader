import { invoke } from "@tauri-apps/api/core";

export async function setMagnetHandler(enabled: boolean): Promise<void> {
  await invoke("set_magnet_handler", { enabled });
}
