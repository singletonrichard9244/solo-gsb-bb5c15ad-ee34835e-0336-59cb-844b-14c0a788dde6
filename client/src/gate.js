/**
 * Release gate: SemVer parsing/comparison + publish verdict.
 *
 * The gate is evaluated entirely in the browser from the already-fetched
 * /api/diff result, so switching perspective or editing a version re-computes
 * the verdict instantly (no extra request). The server test-suite imports
 * this same ES module to keep the rules under `npm test`.
 *
 * Version parsing follows semver.org 2.0.0 with an optional leading "v":
 *  - core: MAJOR.MINOR.PATCH, numeric identifiers without leading zeros
 *  - prerelease: dot-separated identifiers (1.0.0-rc.1); numeric identifiers
 *    have lower precedence than alphanumeric ones; a version WITHOUT a
 *    prerelease outranks the same version WITH one (1.0.0-rc.1 < 1.0.0)
 *  - build metadata (+build.5) is accepted but ignored for precedence
 *
 * Gate rules (summary = { breaking, compatible, info } from /api/diff):
 *  - downgrade or same precedence            -> always block
 *  - breaking changes present                -> only a MAJOR bump is allowed
 *  - only compatible/info changes            -> at least a MINOR bump
 *  - no contract changes at all              -> any forward bump (patch ok)
 */

// Official semver.org 2.0.0 pattern, plus an optional leading "v".
const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

const NUMERIC_RE = /^\d+$/;

/**
 * Parse a SemVer string. Accepts an optional "v" prefix and build metadata.
 *
 * @param {string} text
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
 *          null when the input is not a valid SemVer version.
 */
export function parseSemver(text) {
  if (typeof text !== "string") return null;
  const match = SEMVER_RE.exec(text.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Normalized form without "v" prefix or build metadata: 1.2.3-rc.1 */
export function formatSemver(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease.length > 0 ? `${base}-${version.prerelease.join(".")}` : base;
}

/** Compare two dot-separated prerelease identifiers per SemVer §11.4. */
function comparePrereleaseIdentifiers(a, b) {
  const aNumeric = NUMERIC_RE.test(a);
  const bNumeric = NUMERIC_RE.test(b);
  if (aNumeric && bNumeric) {
    // No leading zeros allowed by the grammar: longer means larger, and
    // equal-length numeric strings compare correctly lexically. This stays
    // exact even beyond Number.MAX_SAFE_INTEGER.
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  // Numeric identifiers have lower precedence than alphanumeric ones.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * SemVer precedence: @returns {-1 | 0 | 1} (build metadata ignored).
 */
export function compareSemver(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  // A version without prerelease outranks one with prerelease.
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < shared; i += 1) {
    const cmp = comparePrereleaseIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  // All shared identifiers equal: the shorter list has lower precedence.
  if (a.prerelease.length === b.prerelease.length) return 0;
  return a.prerelease.length < b.prerelease.length ? -1 : 1;
}

export const BUMP_KINDS = ["major", "minor", "patch", "prerelease", "none", "downgrade"];

export const BUMP_LABELS = {
  major: "主版本提升",
  minor: "次版本提升",
  patch: "补丁提升",
  prerelease: "预发布提升",
  none: "无变化（同版本）",
  downgrade: "降级",
};

/**
 * Classify the move old -> new. The highest differing numeric component
 * decides (1.2.3 -> 1.2.4-rc.1 is a "patch" bump in prerelease form);
 * "prerelease" means only the prerelease part changed.
 *
 * @returns {"major" | "minor" | "patch" | "prerelease" | "none" | "downgrade"}
 */
export function bumpType(oldVersion, newVersion) {
  const cmp = compareSemver(oldVersion, newVersion);
  if (cmp > 0) return "downgrade";
  if (cmp === 0) return "none";
  if (oldVersion.major !== newVersion.major) return "major";
  if (oldVersion.minor !== newVersion.minor) return "minor";
  if (oldVersion.patch !== newVersion.patch) return "patch";
  return "prerelease";
}

/**
 * Combine the SemVer bump with the /api/diff summary into a verdict.
 *
 * @param {object} oldVersion parsed baseline version
 * @param {object} newVersion parsed target version
 * @param {{ breaking: number, compatible: number, info: number }} summary
 * @returns {{ allowed: boolean, bump: string, reason: string }}
 */
export function evaluateGate(oldVersion, newVersion, summary) {
  const bump = bumpType(oldVersion, newVersion);
  const oldText = formatSemver(oldVersion);
  const newText = formatSemver(newVersion);
  const breaking = summary.breaking;
  const changed = summary.breaking + summary.compatible + summary.info;

  if (bump === "downgrade") {
    return {
      allowed: false,
      bump,
      reason: `目标版本 ${newText} 低于基线版本 ${oldText}：降级发布一律阻止。`,
    };
  }
  if (bump === "none") {
    return {
      allowed: false,
      bump,
      reason: `目标版本与基线版本相同（${oldText}，构建元数据不参与比较）：同版本发布一律阻止。`,
    };
  }
  if (breaking > 0) {
    return bump === "major"
      ? {
          allowed: true,
          bump,
          reason: `存在 ${breaking} 处破坏性变更，仅主版本提升可放行：当前为主版本提升，允许发布。`,
        }
      : {
          allowed: false,
          bump,
          reason: `存在 ${breaking} 处破坏性变更，仅主版本提升可放行：当前为${BUMP_LABELS[bump]}，阻止发布。`,
        };
  }
  if (changed > 0) {
    const ok = bump === "minor" || bump === "major";
    return {
      allowed: ok,
      bump,
      reason: ok
        ? `无破坏性变更，含 ${changed} 处兼容/提示性变更，至少需次版本提升：当前为${BUMP_LABELS[bump]}，允许发布。`
        : `无破坏性变更，含 ${changed} 处兼容/提示性变更，至少需次版本提升：当前为${BUMP_LABELS[bump]}，阻止发布。`,
    };
  }
  return {
    allowed: true,
    bump,
    reason: `两版契约完全一致，无契约变化可补丁发布：当前为${BUMP_LABELS[bump]}，允许发布。`,
  };
}
