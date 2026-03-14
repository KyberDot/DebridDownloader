import { useEffect, useRef, useState } from "react";
import MasterDetail from "../components/MasterDetail";
import { StatsDashboard } from "../components/StatsDashboard";
import { useAuth } from "../hooks/useAuth";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import type { DownloadTask, AppSettings } from "../types";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  getDownloadStatusText,
} from "../utils";

function downloadStatusDotColor(status: DownloadTask["status"]): string {
  if (status === "Downloading" || status === "Pending") return "#3b82f6";
  if (status === "Completed") return "#10b981";
  if (status === "Cancelled") return "#ef4444";
  if (typeof status === "object" && "Failed" in status) return "#ef4444";
  return "#475569";
}

function isActive(status: DownloadTask["status"]): boolean {
  return status === "Downloading" || status === "Pending";
}

function isCompleted(status: DownloadTask["status"]): boolean {
  return status === "Completed";
}

export default function DownloadsPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const progress = useDownloadProgress();

  const completedCountRef = useRef<number>(0);
  const seenCompletedRef = useRef<Set<string>>(new Set());
  // Force re-render when completedCount changes
  const [, setTick] = useState(0);

  // Merge live progress data into task list
  const mergedTasks = tasks.map((task) => {
    const p = progress.get(task.id);
    if (p) {
      return {
        ...task,
        downloaded_bytes: p.downloaded_bytes,
        total_bytes: p.total_bytes,
        speed: p.speed,
        status: p.status,
      };
    }
    return task;
  });

  const completedTasks = mergedTasks.filter((t) => isCompleted(t.status));

  // Poll download tasks every 3 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await downloadsApi.getDownloadTasks();
        setTasks(data);
        // Track newly completed tasks
        for (const task of data) {
          if (
            task.status === "Completed" &&
            !seenCompletedRef.current.has(task.id)
          ) {
            seenCompletedRef.current.add(task.id);
            completedCountRef.current += 1;
            setTick((t) => t + 1);
          }
        }
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Fetch settings on mount
  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  // Listen for refresh-list event
  useEffect(() => {
    const handler = async () => {
      try {
        const data = await downloadsApi.getDownloadTasks();
        setTasks(data);
      } catch {
        // ignore
      }
    };
    window.addEventListener("refresh-list", handler);
    return () => window.removeEventListener("refresh-list", handler);
  }, []);

  // Listen for deselect-item event
  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener("deselect-item", handler);
    return () => window.removeEventListener("deselect-item", handler);
  }, []);

  // Listen for delete-selected — cancel the selected download
  useEffect(() => {
    const handler = () => {
      if (selectedId) {
        downloadsApi.cancelDownload(selectedId).catch(() => {});
      }
    };
    window.addEventListener("delete-selected", handler);
    return () => window.removeEventListener("delete-selected", handler);
  }, [selectedId]);

  const handleCancel = async (id: string) => {
    try {
      await downloadsApi.cancelDownload(id);
    } catch {
      // ignore
    }
  };

  const handleClearCompleted = async () => {
    try {
      await downloadsApi.clearCompletedDownloads();
      const data = await downloadsApi.getDownloadTasks();
      setTasks(data);
      if (selectedId) {
        const stillExists = data.find((t) => t.id === selectedId);
        if (!stillExists) setSelectedId(null);
      }
    } catch {
      // ignore
    }
  };

  // ── List Panel ──────────────────────────────────────────────────────────────

  const listPanel = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-[rgba(255,255,255,0.04)]">
        <span style={{ fontSize: "14px", fontWeight: 600 }} className="text-[#f1f5f9]">
          Downloads
        </span>
        {completedTasks.length > 0 && (
          <button
            onClick={handleClearCompleted}
            className="text-[#475569] hover:text-[#94a3b8] text-[12px] transition-colors"
          >
            Clear Completed
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {mergedTasks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-[#475569] text-[13px]">No downloads</p>
          </div>
        ) : (
          mergedTasks.map((task) => {
            const isSelected = selectedId === task.id;
            const dotColor = downloadStatusDotColor(task.status);
            const active = isActive(task.status);
            const pct =
              task.total_bytes > 0
                ? (task.downloaded_bytes / task.total_bytes) * 100
                : 0;

            const rightLabel = active
              ? `${pct.toFixed(1)}%`
              : `${formatBytes(task.total_bytes)} · ${getDownloadStatusText(task.status)}`;

            return (
              <div
                key={task.id}
                className={`flex items-center gap-3 px-4 cursor-pointer transition-colors duration-150 ${
                  isSelected
                    ? "border-l-2 border-[#10b981] bg-[rgba(16,185,129,0.04)]"
                    : "border-l-2 border-transparent hover:bg-[rgba(255,255,255,0.03)]"
                }`}
                style={{ minHeight: "44px" }}
                onClick={() => setSelectedId(task.id)}
              >
                {/* Status dot */}
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: dotColor }}
                />

                {/* Filename + optional progress bar */}
                <div className="flex-1 min-w-0 py-2">
                  <div className="text-[13px] font-medium text-[#f1f5f9] truncate">
                    {task.filename}
                  </div>
                  {active && pct > 0 && (
                    <div className="mt-1 h-0.5 rounded-full bg-[rgba(59,130,246,0.08)]">
                      <div
                        className="h-0.5 bg-[#3b82f6] rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Right side */}
                <div className="shrink-0 text-[11px] text-[#475569] text-right max-w-[80px] truncate">
                  {rightLabel}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ── Detail Panel ─────────────────────────────────────────────────────────────

  const selectedTask = mergedTasks.find((t) => t.id === selectedId) ?? null;

  let detailPanel: React.ReactNode;

  if (!selectedTask) {
    detailPanel = (
      <StatsDashboard
        user={user}
        downloadTasks={mergedTasks}
        settings={settings}
        completedCount={completedCountRef.current}
      />
    );
  } else {
    const task = selectedTask;
    const active = isActive(task.status);
    const completed = isCompleted(task.status);
    const pct =
      task.total_bytes > 0
        ? (task.downloaded_bytes / task.total_bytes) * 100
        : 0;

    detailPanel = (
      <div className="p-6">
        {/* Filename */}
        <p
          className="text-[#f1f5f9] mb-4 break-all"
          style={{ fontSize: "14px", fontWeight: 600, letterSpacing: "-0.2px" }}
        >
          {task.filename}
        </p>

        {active && (
          <>
            {/* Percentage */}
            <div
              className="text-[#3b82f6] mb-2"
              style={{ fontSize: "24px", fontWeight: 600 }}
            >
              {pct.toFixed(1)}%
            </div>

            {/* 3px progress bar */}
            <div
              className="rounded-full mb-4"
              style={{
                height: "3px",
                backgroundColor: "rgba(59,130,246,0.08)",
              }}
            >
              <div
                className="rounded-full transition-all duration-300"
                style={{
                  height: "3px",
                  width: `${Math.min(pct, 100)}%`,
                  backgroundColor: "#3b82f6",
                }}
              />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Speed
                </div>
                <div className="text-[13px] text-[#f1f5f9] font-medium">
                  {task.speed > 0 ? formatSpeed(task.speed) : "--"}
                </div>
              </div>
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  ETA
                </div>
                <div className="text-[13px] text-[#f1f5f9] font-medium">
                  {formatEta(task.total_bytes, task.downloaded_bytes, task.speed)}
                </div>
              </div>
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Downloaded
                </div>
                <div className="text-[13px] text-[#f1f5f9] font-medium">
                  {formatBytes(task.downloaded_bytes)}{" "}
                  <span className="text-[#475569]">of</span>{" "}
                  {formatBytes(task.total_bytes)}
                </div>
              </div>
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Destination
                </div>
                <div
                  className="text-[13px] text-[#f1f5f9] font-medium truncate"
                  title={task.destination}
                >
                  {task.destination || "--"}
                </div>
              </div>
            </div>

            {/* Cancel button */}
            <button
              onClick={() => handleCancel(task.id)}
              className="text-[#ef4444] hover:bg-[rgba(239,68,68,0.08)] rounded-md px-4 py-2 text-[13px] transition-colors"
            >
              Cancel Download
            </button>
          </>
        )}

        {completed && (
          <div className="flex flex-col gap-3">
            {/* Checkmark + label */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[rgba(16,185,129,0.12)] flex items-center justify-center shrink-0">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-[13px] text-[#10b981] font-medium">
                Download complete
              </span>
            </div>

            {/* Destination */}
            {task.destination && (
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Saved to
                </div>
                <div
                  className="text-[13px] text-[#f1f5f9] font-medium break-all"
                >
                  {task.destination}
                </div>
              </div>
            )}

            {/* Size */}
            {task.total_bytes > 0 && (
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Size
                </div>
                <div className="text-[13px] text-[#f1f5f9] font-medium">
                  {formatBytes(task.total_bytes)}
                </div>
              </div>
            )}
          </div>
        )}

        {!active && !completed && (
          <div className="flex flex-col gap-2">
            <p className="text-[#ef4444] text-[13px]">
              {getDownloadStatusText(task.status)}
            </p>
            {task.destination && (
              <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-3">
                <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
                  Destination
                </div>
                <div className="text-[13px] text-[#f1f5f9] font-medium break-all">
                  {task.destination}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return <MasterDetail listPanel={listPanel} detailPanel={detailPanel} />;
}
