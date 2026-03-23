import { useState, useEffect, useCallback } from "react";
import { checkRclone, listRcloneRemotes } from "../api/rclone";
import type { RcloneInfo } from "../types";

export function useRclone() {
  const [rcloneInfo, setRcloneInfo] = useState<RcloneInfo | null>(null);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkRclone()
      .then((info) => {
        setRcloneInfo(info);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refreshRemotes = useCallback(async () => {
    if (!rcloneInfo?.available) return;
    try {
      const list = await listRcloneRemotes();
      setRemotes(list);
    } catch {
      setRemotes([]);
    }
  }, [rcloneInfo]);

  return { rcloneInfo, remotes, refreshRemotes, loading };
}

/**
 * Detect if a path string is an rclone remote path.
 * Matches: "name:", "name:path", "my-remote:folder/subfolder"
 * Does NOT match: "C:\Users\..." (Windows drive letter)
 */
export function isRclonePath(path: string): boolean {
  const colonIndex = path.indexOf(":");
  if (colonIndex <= 0) return false;
  // Windows drive letter: single char + colon + backslash
  if (colonIndex === 1 && path.length > 2 && path[2] === "\\") return false;
  const name = path.substring(0, colonIndex);
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
