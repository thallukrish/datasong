import readline from 'node:readline/promises';
import process from 'node:process';

const SINGLE_STEP = !['0', 'false', 'off', 'no'].includes(String(process.env.SINGLE_STEP || '1').trim().toLowerCase());

async function waitForEnter(message) {
  if (!SINGLE_STEP || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); } finally { rl.close(); }
}

export const withLightweightModelCall = (Base) => class LightweightModelCallExplorer extends Base {
  async lightweightModelCall(systemPrompt, dynamicPrompt, label = 'MODEL REQUEST') {
    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log(`LEMAP SINGLE STEP — ${label}`);
      console.log('============================================================');
      console.log(`MODEL: ${this.modelName}`);
      console.log('\n[SYSTEM]\n');
      console.log(systemPrompt);
      console.log('\n[USER]\n');
      console.log(dynamicPrompt);
      console.log('============================================================');
    }

    await waitForEnter('\nPress ENTER to send this request to the model... ');
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dynamicPrompt }
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });

    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log('LEMAP SINGLE STEP — RESPONSE');
      console.log('============================================================');
      console.log(`FINISH: ${response?.choices?.[0]?.finish_reason || ''}`);
      console.log('\n[ASSISTANT]\n');
      console.log(response?.choices?.[0]?.message?.content || '{}');
      if (response?.usage) console.log(`\n[USAGE]\n${JSON.stringify(response.usage, null, 2)}`);
      console.log('============================================================');
    }

    await waitForEnter('\nPress ENTER to validate/apply this response and continue... ');
    return response;
  }
};
