import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import process from 'node:process';
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';
import { loadConfig } from '../config/config.js';
import { runConfiguredApplication } from './bootstrap.js';

async function loadDotEnv(file = '.env') {
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

function workflowIdFor(query) {
  const hash = crypto.createHash('sha1').update(String(query).trim().toLowerCase()).digest('hex').slice(0, 12);
  return `workflow:${hash}`;
}

function printQuestion(question = {}) {
  if (question.information) console.log(`\n[LeMap-Web] ${question.information}`);
  console.log(`\n[LeMap-Web] ${question.label || 'Provide a value'}`);
  for (const [index, option] of (question.options || []).entries()) {
    console.log(`  ${index + 1}. ${option}`);
  }
  if (!(question.options || []).length && (question.examples || []).length) {
    console.log(`  Examples: ${question.examples.slice(0, 4).join(' • ')}`);
  }
}

async function main() {
  await loadDotEnv();
  const config = loadConfig(process.env);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    let query = process.argv.slice(2).join(' ').trim();
    if (!query) query = (await rl.question('What do you want to do? ')).trim();
    if (!query) throw new Error('A user goal is required.');

    const requestInput = async (question) => {
      printQuestion(question);
      const raw = (await rl.question('Your answer: ')).trim();
      const options = Array.isArray(question?.options) ? question.options : [];
      const numeric = Number(raw);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) return options[numeric - 1];
      return raw;
    };

    const result = await runConfiguredApplication({
      config,
      chromium,
      workflowId: workflowIdFor(query),
      query,
      requestInput
    });

    console.log(`[LeMap-Web] stopped: ${result.reason} after ${result.steps} step(s)`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`[LeMap-Web] failed: ${error.message}`);
  process.exitCode = 1;
});
