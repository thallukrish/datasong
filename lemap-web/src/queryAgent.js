import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';
import { choosePage, snapshotPage } from './browserCapture.js';
import { preprocessEntity } from './graph/entityPreprocessor.js';
import { projectEntityState } from './graph/entityState.js';
import { exploreLocalEntity } from './explore/localExplorer.js';
import { collectNavigationCandidates } from './explore/navigationCandidates.js';
import { resolveLocalEntity } from './semantic/localEntityResolver.js';
import { scoreNavigationCandidates } from './semantic/navigationScout.js';
import { buildUserQuestions, interpretUserAnswer } from './agent/userInput.js';
import { applyGroupAnswer, chooseExecutableNavigation, executeNavigationCandidate } from './agent/browserActions.js';
import { createSemanticMemory, recordEntityKnowledge, recordSelectedTransition, recordSessionAnswer, startQuerySession } from './agent/memory.js';
import { createModelClient, modelConfigFromEnv } from './agent/modelClient.js';

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const settleMs = Number.isFinite(Number(process.env.LEMAP_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_SETTLE_MS)) : 500;
const maxSteps = Number.isFinite(Number(process.env.LEMAP_MAX_STEPS)) ? Math.max(1, Number(process.env.LEMAP_MAX_STEPS)) : 20;
const memoryFile = path.resolve(process.env.LEMAP_MEMORY_FILE || path.join('data', 'semantic-memory', 'web-map.json'));

function arr(value) { return Array.isArray(value) ? value : []; }
async function capture(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  return { snapshot, graph, state };
}
async function loadMemory(goal) {
  try { return JSON.parse(await fs.readFile(memoryFile, 'utf8')); }
  catch { return createSemanticMemory(goal); }
}
async function saveMemory(memory) {
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify(memory, null, 2), 'utf8');
}
function printQuestion(question) {
  console.log(`\n[LeMap-Web] ${question.label}`);
  question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
}
function workflowContext(memory, session, userAnswers, semanticEntity) {
  const pathEdges = new Set(session.path || []);
  const traversed = arr(memory.workflow?.edges).filter((edge) => pathEdges.has(edge.id));
  return {
    currentEntity: semanticEntity?.semanticName || '',
    traversed: traversed.map((edge) => ({ label: edge.label, role: edge.role, sourceEntityId: edge.sourceEntityId, targetEntityId: edge.targetEntityId })),
    userAnswers
  };
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let browser;
try {
  let userGoal = process.argv.slice(2).join(' ').trim();
  if (!userGoal) userGoal = (await rl.question('What do you want to do? ')).trim();
  if (!userGoal) throw new Error('A user goal is required.');

  const config = modelConfigFromEnv();
  const client = createModelClient(config);
  const model = config.model;
  const memory = await loadMemory(userGoal);
  if (!Array.isArray(memory.sessions)) memory.sessions = [];
  const session = startQuerySession(memory, userGoal);
  await saveMemory(memory);

  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[LeMap-Web] goal: ${userGoal}`);
  console.log(`[LeMap-Web] attached: ${await page.title()} :: ${page.url()}`);
  console.log(`[LeMap-Web] persistent memory: ${memoryFile}`);

  const semanticPath = [];
  for (let step = 1; step <= maxSteps; step += 1) {
    console.log(`\n[LeMap-Web] --- step ${step} ---`);
    const before = await capture(page);
    console.log(`[LeMap-Web] structural entity: ${before.graph.entity.label}`);

    const local = await exploreLocalEntity(page, { settleMs });
    const restored = await capture(page);
    if (!local.restored) throw new Error(`Local exploration did not restore ${before.graph.entity.id}; stopping before user input/navigation.`);

    const semanticEntity = await resolveLocalEntity({
      client,
      model,
      entityGraph: restored.graph,
      observations: local.observations,
      learnedRelationships: local.learnedRelationships
    });
    semanticPath.push(semanticEntity.semanticName || restored.graph.entity.label);
    console.log(`[LeMap-Web] semantic entity: ${semanticEntity.semanticName || '(unnamed)'}`);
    if (semanticEntity.description) console.log(`[LeMap-Web] ${semanticEntity.description}`);

    recordEntityKnowledge(memory, {
      structuralEntity: restored.graph.entity,
      structuralGraph: restored.graph,
      semanticEntity,
      learnedRelationships: local.learnedRelationships,
      observations: local.observations
    });
    await saveMemory(memory);

    const answeredGroupIds = new Set();
    const userAnswers = [];
    while (true) {
      const current = await capture(page);
      const questions = buildUserQuestions({ graph: current.graph, state: current.state, answeredGroupIds });
      const question = questions[0];
      if (!question) break;

      printQuestion(question);
      const rawAnswer = (await rl.question('Your answer: ')).trim();
      const interpretation = await interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer: rawAnswer });
      if (!interpretation.selectedFieldIds.length || interpretation.confidence < 0.45) {
        console.log(`[LeMap-Web] I could not map that confidently (${interpretation.reason || 'no matching option'}). Please answer again.`);
        continue;
      }

      await applyGroupAnswer(page, current.graph, question, interpretation);
      if (settleMs) await page.waitForTimeout(settleMs);
      answeredGroupIds.add(question.groupId);
      const answerRecord = {
        entityId: current.graph.entity.id,
        groupId: question.groupId,
        question: question.label,
        userAnswer: rawAnswer,
        selectedFieldIds: interpretation.selectedFieldIds,
        confidence: interpretation.confidence,
        interpretation: interpretation.reason
      };
      userAnswers.push(answerRecord);
      recordSessionAnswer(memory, session, answerRecord);
      await saveMemory(memory);
      console.log(`[LeMap-Web] interpreted: ${interpretation.selectedFieldIds.join(', ')} (${interpretation.confidence.toFixed(2)})`);
    }

    const completed = await capture(page);
    const candidates = await collectNavigationCandidates(page, completed.graph);
    const context = {
      originalGoal: userGoal,
      semanticPath,
      ...workflowContext(memory, session, userAnswers, semanticEntity)
    };
    const scores = await scoreNavigationCandidates({ client, model, userGoal, semanticEntity, workflowContext: context, candidates });

    console.log('\n[LeMap-Web] navigation ranking:');
    for (const score of scores.slice(0, 8)) {
      const candidate = candidates.find((item) => item.id === score.candidateId);
      console.log(`  ${(candidate?.label || score.candidateId)} :: goal=${score.goalRelevance.toFixed(2)} continuity=${score.continuity.toFixed(2)} forward=${score.forwardProgress.toFixed(2)} role=${score.role}`);
    }

    const selected = chooseExecutableNavigation(scores, candidates);
    if (!selected) {
      console.log('[LeMap-Web] No safe goal-directed continuation was selected. Stopping with current semantic memory persisted.');
      break;
    }

    const sourceEntityId = completed.graph.entity.id;
    console.log(`[LeMap-Web] navigating via: ${selected.candidate.label} (${selected.score.role})`);
    await executeNavigationCandidate(page, selected.candidate);
    if (settleMs) await page.waitForTimeout(settleMs);
    const target = await capture(page);

    const alternatives = candidates.filter((candidate) => candidate.id !== selected.candidate.id);
    recordSelectedTransition(memory, {
      sourceEntityId,
      targetEntityId: target.graph.entity.id,
      candidate: selected.candidate,
      score: selected.score,
      alternatives,
      session
    });
    await saveMemory(memory);

    if (target.graph.entity.id === sourceEntityId && target.graph.entity.presentation?.route === completed.graph.entity.presentation?.route) {
      console.log('[LeMap-Web] Selected navigation produced no new entity/route. Stopping to avoid a loop.');
      break;
    }
  }
} catch (error) {
  console.error(`[LeMap-Web] query agent failed: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  if (browser) await browser.close();
}
