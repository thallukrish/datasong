export const arr = (value) => Array.isArray(value) ? value : [];
export const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
export const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];

export function usageOf(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  return { prompt, completion, total:Number(usage.total_tokens || prompt + completion) };
}

export function addUsage(total, usage) {
  total.prompt += Number(usage?.prompt || 0);
  total.completion += Number(usage?.completion || 0);
  total.total += Number(usage?.total || 0);
}

function combinedUsage(...items) {
  return items.reduce((total, item) => {
    addUsage(total, item);
    return total;
  }, { prompt:0, completion:0, total:0 });
}

function stripFence(value) {
  const raw = String(value || '').trim().replace(/^\uFEFF/, '');
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function parseJson(value) {
  const raw = stripFence(value);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}

  // Some providers occasionally wrap JSON in a short prose prefix/suffix even
  // with response_format=json_object. Recover the outer object without trying
  // to repair genuinely truncated JSON.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

async function createCompletion(client, model, messages, maxTokens) {
  return client.chat.completions.create({
    model,
    messages,
    response_format:{ type:'json_object' },
    thinking:{ type:'disabled' },
    temperature:0,
    max_tokens:maxTokens
  });
}

export async function modelJson(client, model, system, payload, { maxTokens = 1200 } = {}) {
  const input = JSON.stringify(payload);
  const initialBudget = Math.max(128, Math.floor(maxTokens));
  // The caller's budget is an initial allowance, not a correctness limit.
  // A length-terminated response is retried from the original request with
  // more room; a syntactically malformed response gets one normal retry.
  const maxBudget = Math.max(initialBudget, 8192);
  const usages = [];
  let budget = initialBudget;
  let lastRaw = '';
  let lastReason = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const messages = [
      { role:'system', content:`Return ONE complete JSON object only. No markdown fences, prose, comments, or trailing text. ${system}` },
      { role:'user', content:input }
    ];
    const result = await createCompletion(client, model, messages, budget);
    lastRaw = result.choices?.[0]?.message?.content || '';
    lastReason = result.choices?.[0]?.finish_reason || '';
    const attemptUsage = usageOf(result.usage || {});
    usages.push(attemptUsage);
    const parsed = parseJson(lastRaw);
    if (parsed) return { parsed, raw:lastRaw, usage:combinedUsage(...usages), attempts:attempt };
    const nearBudget = attemptUsage.completion >= budget * 0.95;
    const cutOff = lastReason === 'length' || nearBudget;
    console.warn(`[lemap query-v2] incomplete model JSON | attempt ${attempt}/3 | finish ${lastReason || 'unknown'} | output ${attemptUsage.completion}/${budget} | retryable ${attempt < 3}`);
    if (attempt === 3) break;
    if (cutOff) budget = Math.min(maxBudget, Math.max(budget + 512, budget * 2));
  }
  const error = new Error(`Query model returned incomplete JSON after 3 attempts; finish=${lastReason || 'unknown'}; output budget=${budget}. Check model output capacity or simplify response schema.`);
  error.modelUsage = combinedUsage(...usages);
  error.modelRaw = lastRaw;
  throw error;
}
