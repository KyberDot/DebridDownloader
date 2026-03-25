import { invoke } from "@tauri-apps/api/core";
import type { WatchRule, WatchMatch } from "../types";

export async function getWatchRules(): Promise<WatchRule[]> {
  return invoke("get_watch_rules");
}

export async function addWatchRule(rule: WatchRule): Promise<WatchRule> {
  return invoke("add_watch_rule", { rule });
}

export async function updateWatchRule(rule: WatchRule): Promise<WatchRule> {
  return invoke("update_watch_rule", { rule });
}

export async function deleteWatchRule(id: string): Promise<void> {
  return invoke("delete_watch_rule", { id });
}

export async function getWatchMatches(ruleId?: string): Promise<WatchMatch[]> {
  return invoke("get_watch_matches", { ruleId: ruleId ?? null });
}

export async function clearWatchMatches(ruleId?: string): Promise<void> {
  return invoke("clear_watch_matches", { ruleId: ruleId ?? null });
}

export async function runWatchRuleNow(id: string): Promise<WatchMatch[]> {
  return invoke("run_watch_rule_now", { id });
}
