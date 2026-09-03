import fs from 'node:fs/promises';
import path from 'node:path';

function arr(value) { return Array.isArray(value) ? value : []; }
function clean(value, max = 260) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function compactModelResult({ purpose = '', model = '', durationMs = 0, usage = null, finishReason = '', parsed = {} } = {}) {
  const normalizedPurpose = clean(purpose, 80);
  const tokens = {
    prompt: numberOrNull(usage?.prompt_tokens),
    completion: numberOrNull(usage?.completion_tokens),
    total: numberOrNull(usage?.total_tokens),
    cacheHit: numberOrNull(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens)
  };
  const result = {};
  const legacyAnswerInterpreter = normalizedPurpose.includes('user_answer');
  for (const key of ['semanticName', 'decision', 'confidence', 'reason', 'localCompletion']) {
    if (parsed?.[key] === undefined || parsed?.[key] === null || parsed?.[key] === '') continue;
    if (legacyAnswerInterpreter && key === 'reason') {
      result.reason = 'answer interpreted';
      continue;
    }
    result[key] = typeof parsed[key] === 'string' ? clean(parsed[key]) : parsed[key];
  }
  if (arr(parsed?.questionIds).length) result.questionIds = arr(parsed.questionIds).slice(0, 6).map(String);
  if (arr(parsed?.selectedFieldIds).length) result.selectedFieldIds = arr(parsed.selectedFieldIds).slice(0, 6).map(String);
  if (arr(parsed?.subEntities).length) result.subEntities = arr(parsed.subEntities).slice(0, 8).map((item) => clean(item?.semanticName || item?.name || '')).filter(Boolean);
  if (arr(parsed?.interactions).length) result.interactions = arr(parsed.interactions).slice(0, 8).map((item) => clean(item?.semanticKey || item?.semanticName || '')).filter(Boolean);
  if (arr(parsed?.scores).length) result.topScores = arr(parsed.scores).slice(0, 5).map((score) => ({
    candidateId: clean(score?.candidateId, 120),
    role: clean(score?.role, 80),
    goal: numberOrNull(score?.goalRelevance),
    continuity: numberOrNull(score?.continuity),
    forward: numberOrNull(score?.forwardProgress)
  }));
  if (parsed?.value !== undefined && parsed?.value !== null && String(parsed.value) !== '') result.value = 'value provided';
  return {
    purpose: normalizedPurpose,
    model: clean(model, 120),
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    tokens,
    finishReason: clean(finishReason, 80),
    result
  };
}

export function createTokenLedger() {
  const byPurpose = {};
  const total = { calls: 0, prompt: 0, completion: 0, tokens: 0, cacheHit: 0 };
  return {
    add(summary = {}) {
      const purpose = clean(summary.purpose || 'unknown', 80) || 'unknown';
      const bucket = byPurpose[purpose] ||= { calls: 0, prompt: 0, completion: 0, tokens: 0, cacheHit: 0 };
      const tokens = summary.tokens || {};
      const prompt = Number(tokens.prompt) || 0;
      const completion = Number(tokens.completion) || 0;
      const tokenTotal = Number(tokens.total) || prompt + completion;
      const cacheHit = Number(tokens.cacheHit) || 0;
      for (const target of [bucket, total]) {
        target.calls += 1;
        target.prompt += prompt;
        target.completion += completion;
        target.tokens += tokenTotal;
        target.cacheHit += cacheHit;
      }
    },
    summary() { return { byPurpose: structuredClone(byPurpose), total: { ...total } }; }
  };
}

export function summarizeUserInteraction({ question = {}, interpretation = {} } = {}) {
  const isValue = question.answerKind === 'value';
  const base = {
    questionId: clean(question.questionId, 160),
    question: clean(question.label, 240),
    answerKind: clean(question.answerKind, 40),
    mode: interpretation.local ? 'local' : 'model',
    confidence: numberOrNull(interpretation.confidence),
    interpretation: isValue ? 'value interpreted' : clean(interpretation.reason, 260)
  };
  if (question.answerKind === 'choice') {
    const labels = new Map(arr(question.options).map((option) => [String(option.fieldId || ''), String(option.label || '')]));
    return {
      ...base,
      selected: arr(interpretation.selectedFieldIds).map(String).map((fieldId) => ({ fieldId, label: clean(labels.get(fieldId) || '', 180) }))
    };
  }
  return { ...base, inputType: clean(question.inputType, 40), answer: 'value provided' };
}

export async function createRunLogger({ baseDir = path.join('data', 'query-runs'), goal = '' } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.resolve(baseDir, `${stamp}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let sequence = 0;
  const tokenLedger = createTokenLedger();
  const write = async (type, data = {}) => {
    const event = { seq: ++sequence, at: new Date().toISOString(), type, ...data };
    await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  };
  const recordModel = async (summary = {}) => {
    tokenLedger.add(summary);
    return write('model_call', summary);
  };
  const tokenSummary = () => tokenLedger.summary();
  await write('run_start', { goal: clean(goal, 500) });
  return { file, write, recordModel, tokenSummary };
}
