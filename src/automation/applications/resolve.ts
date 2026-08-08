import type { ApplicationInfo, ApplicationResolveResult } from "./types";
import { APP_ALIASES, normalizeAppName } from "./normalize";
import { isSensitiveApplication, sensitiveBlockReason } from "./sensitive";

function preferStandardInstall(a: ApplicationInfo, b: ApplicationInfo): ApplicationInfo {
  const score = (app: ApplicationInfo): number => {
    if (app.path.startsWith("/Applications/")) return 3;
    if (app.path.startsWith("/System/Applications/")) return 2;
    if (app.path.includes("/Applications/")) return 1;
    return 0;
  };
  return score(a) >= score(b) ? a : b;
}

/**
 * Resolve a user/AI-provided application name against discovered apps.
 *
 * Order:
 * 1. Exact application name
 * 2. Case-insensitive exact match
 * 3. Normalized .app match (via normalizeAppName)
 * 4. Safe unambiguous alias match (only if target exists; never substring fallback)
 *
 * Never opens a different app as a fuzzy fallback.
 */
export function resolveApplicationFromList(
  query: string,
  inventory: ApplicationInfo[],
): ApplicationResolveResult {
  const trimmed = query.trim();
  const apps = inventory;

  // 1. Exact application name (case-sensitive)
  const exact = apps.filter((app) => app.name === trimmed);
  const exactResolved = resolveUniqueOrAmbiguous(trimmed, exact);
  if (exactResolved) return exactResolved;

  // 2–3. Case-insensitive / .app-normalized exact match
  const normalizedQuery = normalizeAppName(trimmed);
  const ciExact = apps.filter(
    (app) => normalizeAppName(app.name) === normalizedQuery,
  );
  const ciResolved = resolveUniqueOrAmbiguous(trimmed, ciExact);
  if (ciResolved) return ciResolved;

  // 4. Safe unambiguous alias match — only known aliases, never substring
  const aliasTargets = APP_ALIASES[normalizedQuery];
  if (aliasTargets) {
    const matched: ApplicationInfo[] = [];
    for (const target of aliasTargets) {
      const found = apps.filter(
        (app) => normalizeAppName(app.name) === normalizeAppName(target),
      );
      for (const app of found) {
        if (!matched.some((m) => m.path === app.path)) {
          matched.push(app);
        }
      }
    }
    const aliasResolved = resolveUniqueOrAmbiguous(trimmed, matched);
    if (aliasResolved) return aliasResolved;
  }

  return { status: "not_found", query: trimmed };
}

/**
 * Collapse same-name duplicates under different paths:
 * - Prefer /Applications when names match exactly (unambiguous install preference)
 * - If distinct display names remain after path collapse → ambiguous
 */
function resolveUniqueOrAmbiguous(
  query: string,
  matches: ApplicationInfo[],
): ApplicationResolveResult | null {
  if (matches.length === 0) return null;

  // Group by normalized name; within a name, prefer standard install path.
  const byName = new Map<string, ApplicationInfo>();
  for (const app of matches) {
    const key = normalizeAppName(app.name);
    const existing = byName.get(key);
    byName.set(key, existing ? preferStandardInstall(existing, app) : app);
  }

  const unique = [...byName.values()];
  if (unique.length === 1) {
    return finalize(query, unique[0]);
  }

  return { status: "ambiguous", query, candidates: unique };
}

function finalize(
  query: string,
  app: ApplicationInfo,
): ApplicationResolveResult {
  if (isSensitiveApplication(app)) {
    return {
      status: "blocked",
      query,
      app,
      reason: sensitiveBlockReason(app.name),
    };
  }
  return { status: "found", app };
}
