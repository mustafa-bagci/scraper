/**
 * Minimal robots.txt parser covering the directives that matter for a polite
 * crawler: User-agent grouping, Allow, Disallow and Crawl-delay.
 */

export type RobotsRules = {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
};

export const ALLOW_ALL: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

export function parseRobots(body: string, userAgent: string): RobotsRules {
  const token = userAgent.split('/')[0]?.toLowerCase() ?? '*';
  const groups = new Map<string, RobotsRules>();
  let currentAgents: string[] = [];
  let expectingAgents = true;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!expectingAgents) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      expectingAgents = true;
      continue;
    }

    if (currentAgents.length === 0) continue;
    expectingAgents = false;

    for (const agent of currentAgents) {
      const rules = groups.get(agent) ?? { disallow: [], allow: [], crawlDelayMs: null };
      if (field === 'disallow' && value) rules.disallow.push(value);
      else if (field === 'disallow' && !value) rules.disallow.length = 0; // empty Disallow allows all
      else if (field === 'allow' && value) rules.allow.push(value);
      else if (field === 'crawl-delay') {
        const seconds = Number.parseFloat(value);
        if (Number.isFinite(seconds) && seconds >= 0) rules.crawlDelayMs = Math.min(seconds * 1000, 30000);
      }
      groups.set(agent, rules);
    }
  }

  return groups.get(token) ?? groups.get('*') ?? ALLOW_ALL;
}

export function isPathAllowed(pathname: string, rules: RobotsRules): boolean {
  const path = pathname || '/';
  const longestAllow = longestMatch(path, rules.allow);
  const longestDisallow = longestMatch(path, rules.disallow);
  if (longestDisallow === null) return true;
  if (longestAllow === null) return false;
  // The most specific rule wins; ties go to Allow, per the common convention.
  return longestAllow >= longestDisallow;
}

function longestMatch(path: string, patterns: string[]): number | null {
  let best: number | null = null;
  for (const pattern of patterns) {
    if (matchesPattern(path, pattern) && (best === null || pattern.length > best)) best = pattern.length;
  }
  return best;
}

function matchesPattern(path: string, pattern: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const segments = body.split('*');

  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? '';
    if (segment === '') continue;
    const index = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, cursor);
    if (index === -1) return false;
    cursor = index + segment.length;
  }

  if (anchored) return cursor === path.length;
  return true;
}
