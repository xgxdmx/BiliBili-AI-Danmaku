// ============================================================
// Quick Reply Engine - 固定回复规则匹配引擎
// ============================================================

import type { QuickReplyRule } from "./config-store";

interface MatchResult {
  rule: QuickReplyRule;
  reply: string;
}

export class QuickReplyEngine {
  private enabled = false;
  private rules: QuickReplyRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();
  private lastFiredAt: Map<string, number> = new Map();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateRules(rules: QuickReplyRule[]): void {
    this.rules = rules.filter((r) => r.enabled);
    this.regexCache.clear();
    for (const rule of this.rules) {
      if (rule.regex) {
        try {
          this.regexCache.set(rule.id, new RegExp(rule.regex));
        } catch {
          // skip invalid regex
        }
      }
    }
  }

  match(content: string): MatchResult | null {
    if (!this.enabled || !content || !this.rules.length) return null;

    const now = Date.now();

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const hay = rule.caseSensitive ? content : content.toLowerCase();

      // 1) Check notContains exclusions (any hit = skip)
      if (rule.notContains && rule.notContains.length > 0) {
        const excludeList = rule.notContains.filter(Boolean);
        if (excludeList.some((word) => {
          const needle = rule.caseSensitive ? word : word.toLowerCase();
          return hay.includes(needle);
        })) {
          continue;
        }
      }

      // 2) Check contains (any hit = match)
      let matchedByContains = false;
      if (rule.contains && rule.contains.length > 0) {
        const includeList = rule.contains.filter(Boolean);
        matchedByContains = includeList.some((word) => {
          const needle = rule.caseSensitive ? word : word.toLowerCase();
          return hay.includes(needle);
        });
      }

      // 3) Check regex if provided
      let matchedByRegex = false;
      if (rule.regex) {
        const regex = this.regexCache.get(rule.id);
        if (regex && regex.test(content)) {
          matchedByRegex = true;
        }
      }

      // Rule matches if contains OR regex hits
      const isMatch = matchedByContains || matchedByRegex;
      if (!isMatch) continue;

      // 4) Check cooldown
      if (rule.cooldownMs > 0) {
        const lastFired = this.lastFiredAt.get(rule.id) || 0;
        if (now - lastFired < rule.cooldownMs) continue;
      }

      // 5) Fire
      this.lastFiredAt.set(rule.id, now);
      return { rule, reply: rule.reply };
    }

    return null;
  }
}
