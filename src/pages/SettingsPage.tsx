import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as settingsApi from "../api/settings";
import type { AppSettings } from "../types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await settingsApi.getSettings();
        setSettings(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    try {
      await settingsApi.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  const handlePickFolder = async () => {
    const folder = await open({
      directory: true,
      title: "Select default download folder",
    });
    if (folder && settings) {
      setSettings({ ...settings, download_folder: folder as string });
    }
  };

  if (loading || !settings) {
    return (
      <div className="p-6">
        <h2 className="text-3xl font-bold text-zinc-100 mb-8 tracking-tight">Settings</h2>
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-rd-green/30 border-t-rd-green rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-3xl font-bold text-zinc-100 mb-8 tracking-tight">Settings</h2>

      <div className="space-y-8">
        {/* Download folder */}
        <div className="p-5 card-base">
          <label className="block text-sm font-medium text-zinc-200 mb-1 border-l-2 border-rd-green/30 pl-3">
            Default Download Folder
          </label>
          <p className="text-xs text-zinc-500 mb-3">
            Where files are saved when downloading
          </p>
          <div className="flex gap-2">
            <div className="flex-1 px-4 py-2.5 bg-rd-darker border border-rd-border rounded-lg text-sm text-zinc-400 truncate">
              {settings.download_folder ?? "Not set — will ask each time"}
            </div>
            <button
              onClick={handlePickFolder}
              className="px-4 py-2.5 bg-rd-surface border border-rd-border rounded-lg text-sm text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 hover:shadow-[0_0_20px_rgba(120,190,32,0.15)] transition-all duration-150 shrink-0"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Concurrent downloads */}
        <div className="p-5 card-base">
          <label className="block text-sm font-medium text-zinc-200 mb-1 border-l-2 border-rd-green/30 pl-3">
            Max Concurrent Downloads
          </label>
          <p className="text-xs text-zinc-500 mb-3">
            Number of files to download simultaneously
          </p>
          <select
            value={settings.max_concurrent_downloads}
            onChange={(e) =>
              setSettings({
                ...settings,
                max_concurrent_downloads: Number(e.target.value),
              })
            }
            className="w-full px-4 py-2.5 bg-rd-darker border border-rd-border rounded-lg text-sm text-zinc-300 focus:outline-none focus:border-rd-green transition-colors"
          >
            {[1, 2, 3, 4, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} simultaneous download{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Torrent subfolders */}
        <div className="p-5 card-base">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.create_torrent_subfolders}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  create_torrent_subfolders: e.target.checked,
                })
              }
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Create subfolders per torrent
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Organize downloaded files into folders named after each torrent
              </p>
            </div>
          </label>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            saved
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-rd-green text-black hover:bg-green-400 shadow-lg shadow-rd-green/20 shadow-[0_0_20px_rgba(120,190,32,0.15)]"
          }`}
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
