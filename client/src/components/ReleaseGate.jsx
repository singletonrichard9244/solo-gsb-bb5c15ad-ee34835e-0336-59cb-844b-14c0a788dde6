import { useMemo, useState } from "react";
import { BUMP_LABELS, evaluateGate, formatSemver, parseSemver } from "../gate.js";

const PERSPECTIVE_LABELS = {
  request: "请求体视角",
  response: "响应体视角",
};

const VERSION_HINT = "需形如 1.4.0，可带 v 前缀与预发布标识（如 v2.0.0-rc.1）";

/**
 * Release gate: combines the current /api/diff result with the baseline and
 * target SemVer inputs. Everything below is derived state, so switching
 * perspective (new diff prop) or editing a version re-computes instantly.
 */
export default function ReleaseGate({ diff }) {
  const [baselineVersion, setBaselineVersion] = useState("");
  const [targetVersion, setTargetVersion] = useState("");
  const [copied, setCopied] = useState(false);

  const oldVersion = useMemo(() => parseSemver(baselineVersion), [baselineVersion]);
  const newVersion = useMemo(() => parseSemver(targetVersion), [targetVersion]);
  const oldInvalid = baselineVersion.trim() !== "" && !oldVersion;
  const newInvalid = targetVersion.trim() !== "" && !newVersion;

  const verdict = useMemo(() => {
    if (!oldVersion || !newVersion) return null;
    return evaluateGate(oldVersion, newVersion, diff.summary);
  }, [oldVersion, newVersion, diff]);

  async function copyReport() {
    if (!verdict) return;
    const report = {
      versions: { baseline: formatSemver(oldVersion), target: formatSemver(newVersion) },
      perspective: diff.perspective,
      summary: diff.summary,
      verdict: { allowed: verdict.allowed, bump: verdict.bump, reason: verdict.reason },
      generatedAt: new Date().toISOString(),
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="gate">
      <div className="gate__head">
        <h3 className="gate__title">发布门禁</h3>
        <span className="panel__meta">
          结合{PERSPECTIVE_LABELS[diff.perspective]}差异，按 SemVer 规则即时判定
        </span>
      </div>

      <div className="gate__form">
        <label className="gate__field">
          <span className="gate__label">基线版本（当前 SemVer）</span>
          <input
            type="text"
            className={`gate__input ${oldInvalid ? "gate__input--err" : ""}`}
            value={baselineVersion}
            placeholder="如 1.4.0"
            spellCheck="false"
            onChange={(e) => setBaselineVersion(e.target.value)}
          />
          {oldInvalid && <span className="gate__field-err">无效版本：{VERSION_HINT}</span>}
        </label>
        <span className="gate__arrow">→</span>
        <label className="gate__field">
          <span className="gate__label">新版版本（目标 SemVer）</span>
          <input
            type="text"
            className={`gate__input ${newInvalid ? "gate__input--err" : ""}`}
            value={targetVersion}
            placeholder="如 2.0.0-rc.1"
            spellCheck="false"
            onChange={(e) => setTargetVersion(e.target.value)}
          />
          {newInvalid && <span className="gate__field-err">无效版本：{VERSION_HINT}</span>}
        </label>
      </div>

      {!verdict && !oldInvalid && !newInvalid && (
        <div className="panel__meta gate__hint">
          填写基线版本与新版版本后，在此生成允许/阻止结论。
        </div>
      )}

      {verdict && (
        <>
          <div className={`gate__verdict ${verdict.allowed ? "gate__verdict--allow" : "gate__verdict--block"}`}>
            <span className="gate__badge">{verdict.allowed ? "✓ 允许发布" : "✗ 阻止发布"}</span>
            <span className="gate__bump">实际升级类型：{BUMP_LABELS[verdict.bump]}</span>
          </div>
          <div className="gate__meta">
            触发结论的变更：{diff.summary.breaking} 破坏性 · {diff.summary.compatible} 兼容 ·{" "}
            {diff.summary.info} 提示（{PERSPECTIVE_LABELS[diff.perspective]}）
          </div>
          <div className="gate__reason">{verdict.reason}</div>
          <div className="actions">
            <button type="button" className="btn btn--sm btn--primary" onClick={copyReport}>
              {copied ? "✓ 已复制" : "复制 JSON 报告"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
