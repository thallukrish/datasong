import readline from 'node:readline/promises';
import process from 'node:process';
import { ProgressiveRepositoryExplorerV4 } from './progressiveRepositoryExplorerV4.js';

const SINGLE_STEP = !['0', 'false', 'off', 'no'].includes(String(process.env.SINGLE_STEP || '1').trim().toLowerCase());

const ORIENTATION_SYSTEM_PROMPT = `You are navigating an unfamiliar repository.
Choose the next repository location most likely to reveal meaningful business behavior.
Use only the structural evidence supplied. Do not infer a workflow yet.
Return strict JSON matching the supplied contract.`;

const SOURCE_INDEX_SYSTEM_PROMPT = `You are inspecting a source-file function index while navigating an unfamiliar repository.
Choose the function most likely to reveal meaningful business behavior. You have signatures only, not bodies.
Do not infer a workflow from a filename or signature alone.
Return strict JSON matching the supplied contract.`;

async function waitForEnter(message) {
  if (!SINGLE_STEP || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); } finally { rl.close(); }
}

function isMode(prompt, mode) {
  return String(prompt || '').startsWith(`MODE: ${mode}`);
}

export class ProgressiveRepositoryExplorerV5 extends ProgressiveRepositoryExplorerV4 {
  buildPrompt(observation, candidates) {
    if (observation?.kind === 'repo_directory') {
      const directory = observation.canonical || {};
      const contract = {
        evidenceRequest: {
          type: 'listDirectory|getArtifact|stop',
          artifactId: 'exact file id for getArtifact',
          path: 'exact child or previewed directory path for listDirectory'
        }
      };
      return `MODE: REPOSITORY ORIENTATION\nDIRECTORY\n${JSON.stringify(directory)}\nRETURN\n${JSON.stringify(contract)}\nRules: choose one next location; use previewed deeper paths when useful; never request the directory already shown; copy ids/paths exactly.`;
    }

    if (observation?.kind === 'source_file_index') {
      const source = observation.canonical || {};
      const contract = {
        evidenceRequest: {
          type: 'getFunction|getArtifact|listDirectory|backtrack|stop',
          artifactId: 'exact function/file id when applicable',
          path: 'exact directory path only for listDirectory'
        }
      };
      return `MODE: SOURCE FILE INDEX\nSOURCE\n${JSON.stringify(source)}\nRETURN\n${JSON.stringify(contract)}\nRules: signatures only; choose one promising function with getFunction when possible; copy ids exactly.`;
    }

    return super.buildPrompt(observation, candidates);
  }

  async lightweightModelCall(systemPrompt, dynamicPrompt, label) {
    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log(`DATASONG SINGLE STEP — ${label}`);
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
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: dynamicPrompt }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });

    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log('DATASONG SINGLE STEP — RESPONSE');
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

  async callModel(dynamicPrompt) {
    if (isMode(dynamicPrompt, 'REPOSITORY ORIENTATION')) {
      return this.lightweightModelCall(ORIENTATION_SYSTEM_PROMPT, dynamicPrompt, 'ORIENTATION REQUEST');
    }
    if (isMode(dynamicPrompt, 'SOURCE FILE INDEX')) {
      return this.lightweightModelCall(SOURCE_INDEX_SYSTEM_PROMPT, dynamicPrompt, 'SOURCE INDEX REQUEST');
    }
    return super.callModel(dynamicPrompt);
  }
}
