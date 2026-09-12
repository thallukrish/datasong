function chatEndpoint(endpoint = '') {
  const base = String(endpoint || '').trim().replace(/\/$/, '');
  if (!base) return '';
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function systemInstruction(operation) {
  if (operation === 'choose_navigation') {
    return 'Choose only from the supplied navigation candidates. Return JSON only: {"selectedEntityId":"candidate-id"}. Return an empty string id when none should be chosen.';
  }
  return 'Add semantic understanding only for supplied target entities. Never invent entity ids, browser structure, links, selectors, or user values. Return JSON only with shape {"patches":[{"entityId":"id","semantic":{...}}]}.';
}

function parseModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Model response did not contain JSON content.');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Model response content was not valid JSON.');
  }
}

export function createProviderInvoke({ config = {}, fetchImpl = globalThis.fetch } = {}) {
  const provider = String(config.provider || '').trim().toLowerCase();
  const model = String(config.name || '').trim();
  const endpoint = chatEndpoint(config.endpoint);
  const apiKey = String(config.apiKey || '').trim();

  if (!provider || !model || !endpoint || !apiKey) {
    throw new Error('Complete model provider configuration is required.');
  }
  if (!['openai-compatible', 'openai', 'deepseek'].includes(provider)) {
    throw new Error(`Unsupported model provider: ${provider}`);
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  return async ({ operation, payload } = {}) => {
    const normalizedOperation = String(operation || '').trim();
    if (!normalizedOperation) throw new Error('Model operation is required.');

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemInstruction(normalizedOperation) },
          { role: 'user', content: JSON.stringify({ operation: normalizedOperation, ...payload }) }
        ]
      })
    });

    if (!response?.ok) throw new Error(`Model request failed with HTTP ${response?.status || 'unknown'}.`);
    return parseModelContent(await response.json());
  };
}
