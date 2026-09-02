export async function callJsonModel({ client, model, systemPrompt, userPrompt }) {
  if (!client?.chat?.completions?.create) throw new Error('A chat-completions compatible client is required');
  if (!model) throw new Error('model is required');
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      { role: 'user', content: String(userPrompt || '') }
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }
  });
  const raw = response?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw new Error(`Model returned invalid JSON: ${error.message}`); }
  return { parsed, raw, usage: response?.usage || null, finishReason: response?.choices?.[0]?.finish_reason || '' };
}
