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

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return null; }
}

export async function modelJson(client, model, system, payload, { maxTokens = 1200 } = {}) {
  const completion = await client.chat.completions.create({
    model,
    messages:[
      { role:'system', content:`Return compact JSON only. ${system}` },
      { role:'user', content:JSON.stringify(payload) }
    ],
    response_format:{ type:'json_object' },
    thinking:{ type:'disabled' },
    temperature:0,
    max_tokens:maxTokens
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  const parsed = parseJson(raw);
  if (!parsed) throw new Error('Query DFS model returned malformed JSON');
  return { parsed, raw, usage:usageOf(completion.usage || {}) };
}
