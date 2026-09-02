import process from 'node:process';

function endpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

export function modelConfigFromEnv(env = process.env) {
  const apiKey = env.LEMAP_MODEL_API_KEY || env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '';
  const baseUrl = env.LEMAP_MODEL_BASE_URL || (env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' : 'https://api.openai.com/v1');
  const model = env.LEMAP_MODEL || (env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-5-mini');
  return { apiKey, baseUrl, model };
}

export function createModelClient({ apiKey = '', baseUrl = '' } = {}) {
  if (!apiKey) throw new Error('Model API key missing. Set LEMAP_MODEL_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY.');
  if (!baseUrl) throw new Error('Model base URL missing.');
  return {
    chat: {
      completions: {
        create: async (request) => {
          const { thinking: _thinking, ...portableRequest } = request || {};
          const response = await fetch(endpoint(baseUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(portableRequest)
          });
          if (!response.ok) throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
          return response.json();
        }
      }
    }
  };
}
