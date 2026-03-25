import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import * as watchlistApi from "../api/watchlist";
import type { WatchRule, WatchMatch } from "../types";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function intervalLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${mins / 60}h`;
}

// ── Rule Modal ──────────────────────────────────────────────────────

interface RuleModalProps {
  rule: WatchRule | null;
  onClose: () => void;
  onSave: (rule: WatchRule) => Promise<void>;
}

function RuleModal({ rule, onClose, onSave }: RuleModalProps) {
  const isEdit = rule !== null;
  const [name, setName] = useState(rule?.name ?? "");
  const [ruleType, setRuleType] = useState<"Keyword" | "TvShow">(
    rule?.rule_type.type === "TvShow" ? "TvShow" : "Keyword"
  );
  const [query, setQuery] = useState(rule?.query ?? "");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [action, setAction] = useState<"Notify" | "AutoAdd">(rule?.action ?? "Notify");
  const [intervalMinutes, setIntervalMinutes] = useState(rule?.interval_minutes ?? 30);
  const [regexFilter, setRegexFilter] = useState(rule?.regex_filter ?? "");
  const [minSeeders, setMinSeeders] = useState(rule?.min_seeders?.toString() ?? "");
  const [minSize, setMinSize] = useState(rule?.min_size_bytes?.toString() ?? "");
  const [maxSize, setMaxSize] = useState(rule?.max_size_bytes?.toString() ?? "");
  const [lastSeason, setLastSeason] = useState(
    rule?.rule_type.type === "TvShow" ? (rule.rule_type.last_season?.toString() ?? "") : ""
  );
  const [lastEpisode, setLastEpisode] = useState(
    rule?.rule_type.type === "TvShow" ? (rule.rule_type.last_episode?.toString() ?? "") : ""
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!name.trim() || !query.trim()) {
      setError("Name and query are required");
      return;
    }
    setSaving(true);
    setError("");

    const newRule: WatchRule = {
      id: rule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      rule_type:
        ruleType === "TvShow"
          ? {
              type: "TvShow",
              last_season: lastSeason ? parseInt(lastSeason) : null,
              last_episode: lastEpisode ? parseInt(lastEpisode) : null,
            }
          : { type: "Keyword" },
      query: query.trim(),
      category: category || null,
      regex_filter: regexFilter || null,
      min_seeders: minSeeders ? parseInt(minSeeders) : null,
      min_size_bytes: minSize ? parseInt(minSize) : null,
      max_size_bytes: maxSize ? parseInt(maxSize) : null,
      action,
      interval_minutes: intervalMinutes,
      enabled: rule?.enabled ?? true,
      created_at: rule?.created_at ?? new Date().toISOString(),
      last_checked: rule?.last_checked ?? null,
    };

    try {
      await onSave(newRule);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to save");
      setSaving(false);
    }
  };

  const categories = [
    { value: "", label: "All" },
    { value: "movies", label: "Movies" },
    { value: "tv", label: "TV" },
    { value: "music", label: "Music" },
    { value: "games", label: "Games" },
    { value: "software", label: "Software" },
  ];

  const intervals = [
    { value: 15, label: "15 minutes" },
    { value: 30, label: "30 minutes" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
    { value: 360, label: "6 hours" },
  ];

  const inputClass = "w-full px-3 py-2 rounded-lg text-[13px] bg-[var(--theme-bg)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] focus:outline-none focus:border-[var(--accent)]";
  const labelClass = "text-[12px] text-[var(--theme-text-muted)] mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto rounded-xl p-6"
        style={{ backgroundColor: "var(--theme-bg-surface)", border: "1px solid var(--theme-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-[var(--theme-text-primary)] mb-4">
          {isEdit ? "Edit Rule" : "Add Rule"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Watch Rule" />
          </div>

          <div>
            <label className={labelClass}>Type</label>
            <div className="flex gap-2">
              {(["Keyword", "TvShow"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setRuleType(t)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                  style={{
                    backgroundColor: ruleType === t ? "var(--accent-bg-light)" : "var(--theme-bg)",
                    color: ruleType === t ? "var(--accent)" : "var(--theme-text-muted)",
                    border: `1px solid ${ruleType === t ? "var(--accent)" : "var(--theme-border)"}`,
                  }}
                >
                  {t === "TvShow" ? "TV Show" : "Keyword"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>Search Query</label>
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g., Breaking Bad 2160p" />
          </div>

          <div>
            <label className={labelClass}>Category</label>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {ruleType === "TvShow" && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>Start from Season (optional)</label>
                <input className={inputClass} type="number" min="1" value={lastSeason} onChange={(e) => setLastSeason(e.target.value)} placeholder="Auto-detect" />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Start from Episode (optional)</label>
                <input className={inputClass} type="number" min="0" value={lastEpisode} onChange={(e) => setLastEpisode(e.target.value)} placeholder="Auto-detect" />
              </div>
            </div>
          )}

          <div>
            <label className={labelClass}>Action</label>
            <div className="flex gap-2">
              {(["Notify", "AutoAdd"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                  style={{
                    backgroundColor: action === a ? "var(--accent-bg-light)" : "var(--theme-bg)",
                    color: action === a ? "var(--accent)" : "var(--theme-text-muted)",
                    border: `1px solid ${action === a ? "var(--accent)" : "var(--theme-border)"}`,
                  }}
                >
                  {a === "AutoAdd" ? "Auto-Add" : "Notify"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>Check Interval</label>
            <select className={inputClass} value={intervalMinutes} onChange={(e) => setIntervalMinutes(parseInt(e.target.value))}>
              {intervals.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
          >
            {showAdvanced ? "Hide" : "Show"} Advanced Filters
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-3 border-l-2 border-[var(--theme-border-subtle)]">
              <div>
                <label className={labelClass}>Regex Filter (applied to title)</label>
                <input className={inputClass} value={regexFilter} onChange={(e) => setRegexFilter(e.target.value)} placeholder="e.g., (2160p|4K)" />
              </div>
              <div>
                <label className={labelClass}>Min Seeders</label>
                <input className={inputClass} type="number" min="0" value={minSeeders} onChange={(e) => setMinSeeders(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelClass}>Min Size (bytes)</label>
                  <input className={inputClass} type="number" min="0" value={minSize} onChange={(e) => setMinSize(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className={labelClass}>Max Size (bytes)</label>
                  <input className={inputClass} type="number" min="0" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-[13px] text-[#ef4444]">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
              style={{ background: "var(--theme-hover)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
            >
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Watch List Page ─────────────────────────────────────────────────

export default function WatchListPage() {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [matches, setMatches] = useState<WatchMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<WatchRule | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        watchlistApi.getWatchRules(),
        watchlistApi.getWatchMatches(),
      ]);
      setRules(r);
      setMatches(m);
    } catch (e) {
      console.error("Failed to load watch list data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unlisten = listen("watchlist-match", () => {
      loadData();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadData]);

  useEffect(() => {
    localStorage.setItem("last_visited_watchlist", new Date().toISOString());
  }, []);

  const handleToggle = async (rule: WatchRule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    await watchlistApi.updateWatchRule(updated);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await watchlistApi.deleteWatchRule(id);
    if (selectedRuleId === id) setSelectedRuleId(null);
    loadData();
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await watchlistApi.runWatchRuleNow(id);
      await loadData();
    } catch (e) {
      console.error("Run failed:", e);
    } finally {
      setRunningId(null);
    }
  };

  const handleClearMatches = async () => {
    await watchlistApi.clearWatchMatches(selectedRuleId ?? undefined);
    loadData();
  };

  const filteredMatches = selectedRuleId
    ? matches.filter((m) => m.rule_id === selectedRuleId)
    : matches;

  const ruleNameMap = Object.fromEntries(rules.map((r) => [r.id, r.name]));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--theme-text-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--theme-border-subtle)]">
        <h1 className="text-[20px] font-semibold text-[var(--theme-text-primary)]">Watch List</h1>
        <button
          onClick={() => { setEditingRule(null); setShowModal(true); }}
          className="px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
        >
          Add Rule
        </button>
      </div>

      {/* Rules Table */}
      <div className="flex-1 overflow-auto px-6 py-4 min-h-0" style={{ maxHeight: "50%" }}>
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--theme-text-muted)]">
            <p className="text-[15px]">No watch rules yet</p>
            <p className="text-[13px] mt-1">Create a rule to start monitoring your trackers</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[var(--theme-text-muted)] text-[11px] uppercase tracking-wider">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Query</th>
                <th className="pb-2 font-medium">Action</th>
                <th className="pb-2 font-medium">Interval</th>
                <th className="pb-2 font-medium">Last Checked</th>
                <th className="pb-2 font-medium text-center">Enabled</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr
                  key={rule.id}
                  className="border-t border-[var(--theme-border-subtle)] cursor-pointer transition-colors"
                  style={{
                    backgroundColor: selectedRuleId === rule.id ? "var(--accent-bg-light)" : "transparent",
                  }}
                  onClick={() => setSelectedRuleId(selectedRuleId === rule.id ? null : rule.id)}
                  onMouseEnter={(e) => {
                    if (selectedRuleId !== rule.id) e.currentTarget.style.backgroundColor = "var(--theme-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedRuleId !== rule.id) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <td className="py-2.5 text-[var(--theme-text-primary)] font-medium">{rule.name}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      rule.rule_type.type === "TvShow"
                        ? "bg-[rgba(139,92,246,0.12)] text-[#8b5cf6]"
                        : "bg-[rgba(59,130,246,0.12)] text-[#3b82f6]"
                    }`}>
                      {rule.rule_type.type === "TvShow" ? "TV" : "Keyword"}
                    </span>
                    {rule.rule_type.type === "TvShow" && rule.rule_type.last_season != null && (
                      <span className="ml-1.5 text-[11px] text-[var(--theme-text-muted)]">
                        S{String(rule.rule_type.last_season).padStart(2, "0")}E{String(rule.rule_type.last_episode ?? 0).padStart(2, "0")}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-[var(--theme-text-secondary)] max-w-[200px] truncate">{rule.query}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      rule.action === "AutoAdd"
                        ? "bg-[rgba(16,185,129,0.12)] text-[#10b981]"
                        : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                    }`}>
                      {rule.action === "AutoAdd" ? "Auto-Add" : "Notify"}
                    </span>
                  </td>
                  <td className="py-2.5 text-[var(--theme-text-muted)]">{intervalLabel(rule.interval_minutes)}</td>
                  <td className="py-2.5 text-[var(--theme-text-muted)]">
                    {rule.last_checked ? formatRelativeTime(rule.last_checked) : "Never"}
                  </td>
                  <td className="py-2.5 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(rule); }}
                      className={`w-8 h-4.5 rounded-full transition-colors relative ${
                        rule.enabled ? "bg-[var(--accent)]" : "bg-[var(--theme-border)]"
                      }`}
                    >
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        rule.enabled ? "translate-x-3.5" : "translate-x-0.5"
                      }`} />
                    </button>
                  </td>
                  <td className="py-2.5">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setEditingRule(rule); setShowModal(true); }}
                        className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
                        title="Edit"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRunNow(rule.id)}
                        disabled={runningId === rule.id}
                        className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors disabled:opacity-50"
                        title="Run Now"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[#ef4444] transition-colors"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Matches Panel */}
      <div className="border-t border-[var(--theme-border-subtle)] flex-1 overflow-auto px-6 py-4 min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-medium text-[var(--theme-text-primary)]">
            Recent Matches
            {selectedRuleId && (
              <span className="ml-2 text-[var(--theme-text-muted)] font-normal">
                — {ruleNameMap[selectedRuleId]}
              </span>
            )}
          </h2>
          {filteredMatches.length > 0 && (
            <button
              onClick={handleClearMatches}
              className="text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {filteredMatches.length === 0 ? (
          <p className="text-[13px] text-[var(--theme-text-muted)] py-4">No matches yet</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[var(--theme-text-muted)] text-[11px] uppercase tracking-wider">
                <th className="pb-2 font-medium">Title</th>
                {!selectedRuleId && <th className="pb-2 font-medium">Rule</th>}
                <th className="pb-2 font-medium">Size</th>
                <th className="pb-2 font-medium">Matched</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {[...filteredMatches].reverse().map((m, i) => (
                <tr key={`${m.info_hash}-${i}`} className="border-t border-[var(--theme-border-subtle)]">
                  <td className="py-2 text-[var(--theme-text-primary)] max-w-[400px] truncate">{m.title}</td>
                  {!selectedRuleId && (
                    <td className="py-2 text-[var(--theme-text-muted)]">{ruleNameMap[m.rule_id] ?? "Unknown"}</td>
                  )}
                  <td className="py-2 text-[var(--theme-text-muted)]">{formatBytes(m.size_bytes)}</td>
                  <td className="py-2 text-[var(--theme-text-muted)]">{formatRelativeTime(m.matched_at)}</td>
                  <td className="py-2">
                    {m.status.type === "Notified" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[rgba(234,179,8,0.12)] text-[#eab308]">Notified</span>
                    )}
                    {m.status.type === "Added" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[rgba(16,185,129,0.12)] text-[#10b981]">Added</span>
                    )}
                    {m.status.type === "Failed" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[rgba(239,68,68,0.12)] text-[#ef4444]" title={m.status.reason}>Failed</span>
                    )}
                  </td>
                  <td className="py-2">
                    {m.status.type === "Notified" && (
                      <button
                        onClick={async () => {
                          try {
                            const { addMagnet, selectTorrentFiles } = await import("../api/torrents");
                            const resp = await addMagnet(m.magnet);
                            await selectTorrentFiles(resp.id, "all").catch(() => {});
                          } catch (e) {
                            console.error("Failed to add magnet:", e);
                          }
                        }}
                        className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
                        style={{ background: "var(--accent-bg-light)", color: "var(--accent)" }}
                      >
                        Add
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Rule Modal */}
      {showModal && (
        <RuleModal
          rule={editingRule}
          onClose={() => { setShowModal(false); setEditingRule(null); }}
          onSave={async (rule) => {
            if (editingRule) {
              await watchlistApi.updateWatchRule(rule);
            } else {
              await watchlistApi.addWatchRule(rule);
            }
            setShowModal(false);
            setEditingRule(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
