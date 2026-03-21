import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

function parseMagnetDisplayName(uri: string): string | null {
  try {
    const match = uri.match(/[?&]dn=([^&]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return null;
  }
}

interface MagnetLinkEvent {
  uri: string;
  displayName: string | null;
}

export function useMagnetLinkListener(
  onMagnetLink: (event: MagnetLinkEvent) => void,
  isAuthenticated: boolean
) {
  const currentUriRef = useRef<string | null>(null);

  const handleMagnetUri = useCallback(
    (uri: string) => {
      if (!isAuthenticated) {
        console.warn("Magnet link received but user is not authenticated");
        return;
      }
      if (currentUriRef.current === uri) {
        return;
      }
      currentUriRef.current = uri;
      const displayName = parseMagnetDisplayName(uri);
      onMagnetLink({ uri, displayName });
    },
    [isAuthenticated, onMagnetLink]
  );

  const clearCurrentUri = useCallback(() => {
    currentUriRef.current = null;
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("magnet-link-received", (event) => {
      handleMagnetUri(event.payload);
    });

    invoke<string | null>("get_pending_magnet_uri").then((uri) => {
      if (uri) {
        handleMagnetUri(uri);
      }
    }).catch(() => {});

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleMagnetUri]);

  return { clearCurrentUri };
}
