const arr = (value) => Array.isArray(value) ? value : [];

export function assessOdooEvidence({
  uiEntrypoints = [],
  projectMethodCount = 0,
  frameworkMethodCount = 0,
  unresolvedCalls = [],
  ambiguousBoundaries = [],
  declarativeOnly = false,
  observed = false
} = {}) {
  const reasons = [];
  const unresolved = [...new Set([...arr(unresolvedCalls), ...arr(ambiguousBoundaries)].filter(Boolean).map(String))].sort();

  if (unresolved.length) {
    reasons.push(`Framework execution remains ambiguous at: ${unresolved.join(', ')}`);
  }

  const hasExecutableEvidence = arr(uiEntrypoints).length > 0
    || Number(projectMethodCount) > 0
    || Number(frameworkMethodCount) > 0;

  if (declarativeOnly && !hasExecutableEvidence) {
    reasons.push('No executable Odoo entrypoint was established; only declarative model/field evidence is available.');
  }

  return {
    evidenceLevel: observed ? 'observed' : 'static',
    runtimeEvidenceRequired: reasons.length > 0,
    runtimeEvidenceReasons: reasons,
    entrypoints: arr(uiEntrypoints),
    ambiguousBoundaries: unresolved
  };
}
