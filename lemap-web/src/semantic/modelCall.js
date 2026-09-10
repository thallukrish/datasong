let modelCallLogger = null;

export function setModelCallLogger(logger) {
  modelCallLogger = typeof logger === 'function' ? logger : null;
}

function purposeFromPrompt(prompt = '') {
  const mode = String(prompt || '').match(/\bMODE\s+([^\s]+)/i)?.[1] || 'model-call';
  return mode.replace(/^web-/, '').replace(/-v\d+$/i, '').replace(/-/g, '_');
}

export async function callJsonModel({ client, model, systemPrompt, userPrompt }) {
  if (!client?.chat?.completions?.create) throw new Error('A chat-completions compatible client is required');
  if (!model) throw new Error('model is required');
  const purpose = purposeFromPrompt(userPrompt);
  const exactSystemPrompt = String(systemPrompt || '');
  const exactUserPrompt = String(userPrompt || '');
  const started = Date.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: exactSystemPrompt },
        { role: 'user', content: exactUserPrompt }
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });
  } catch (error) {
    await modelCallLogger?.({
      purpose,
      model,
      durationMs: Date.now() - started,
      systemPrompt: exactSystemPrompt,
      userPrompt: exactUserPrompt,
      error: error.message
    });
    throw error;
  }
  const raw = response?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    await modelCallLogger?.({
      purpose,
      model,
      durationMs: Date.now() - started,
      usage: response?.usage || null,
      finishReason: response?.choices?.[0]?.finish_reason || '',
      systemPrompt: exactSystemPrompt,
      userPrompt: exactUserPrompt,
      raw,
      error: `invalid JSON: ${error.message}`
    });
    throw new Error(`Model returned invalid JSON: ${error.message}`);
  }
  const result = { parsed, raw, usage: response?.usage || null, finishReason: response?.choices?.[0]?.finish_reason || '' };
  await modelCallLogger?.({
    purpose,
    model,
    durationMs: Date.now() - started,
    usage: result.usage,
    finishReason: result.finishReason,
    systemPrompt: exactSystemPrompt,
    userPrompt: exactUserPrompt,
    raw,
    parsed
  });
  return result;
}
