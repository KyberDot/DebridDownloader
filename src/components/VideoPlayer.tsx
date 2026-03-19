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
