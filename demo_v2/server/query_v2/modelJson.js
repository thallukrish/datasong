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
  const baseMessages = [
    { role:'system', content:`Return compact JSON only. ${system}` },
    { role:'user', content:JSON.stringify(payload) }
  ];

  const first = await createCompletion(client, model, baseMessages, maxTokens);
  const firstRaw = first.choices?.[0]?.message?.content || '';
  const firstUsage = usageOf(first.usage || {});
  const firstParsed = parseJson(firstRaw);
  if (firstParsed) return { parsed:firstParsed, raw:firstRaw, usage:firstUsage, attempts:1 };

  console.warn(`[lemap query-v2] malformed model JSON; retrying once | prompt ${firstUsage.prompt} | output ${firstUsage.completion} | raw ${text(firstRaw, 320)}`);

  // Retry from the original request rather than asking the model to repair a
  // potentially truncated blob; this keeps the second prompt small and avoids
  // circulating malformed output.
  const retryMessages = [
    { role:'system', content:`Return ONE complete compact JSON object only. No markdown fences, prose, comments, or trailing text. ${system}` },
    { role:'user', content:JSON.stringify(payload) }
  ];
  const second = await createCompletion(client, model, retryMessages, maxTokens);
  const secondRaw = second.choices?.[0]?.message?.content || '';
  const secondUsage = usageOf(second.usage || {});
  const secondParsed = parseJson(secondRaw);
  const usage = combinedUsage(firstUsage, secondUsage);

  if (!secondParsed) {
    const error = new Error(`Query DFS model returned malformed JSON after retry; raw=${text(secondRaw || firstRaw, 500)}`);
    error.modelUsage = usage;
    error.modelRaw = secondRaw || firstRaw;
    throw error;
  }

  console.log(`[lemap query-v2] malformed JSON recovered on retry | retry ${secondUsage.total} tokens | combined ${usage.total}`);
  return { parsed:secondParsed, raw:secondRaw, usage, attempts:2 };
}
