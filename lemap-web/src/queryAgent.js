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
import { applyQuestionAnswer, chooseExecutableNavigation, executeNavigationCandidate } from './agent/browserActions.js';
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
  try {
    const memory = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    memory.entities ||= {};
    memory.workflow ||= { nodes: [], edges: [] };
    memory.workflow.nodes ||= [];
    memory.workflow.edges ||= [];
    memory.sessions ||= [];
    return memory;
  } catch {
    return createSemanticMemory(goal);
  }
}
async function saveMemory(memory) {
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify(memory, null, 2), 'utf8');
}
function printQuestion(question) {
  console.log(`\n[LeMap-Web] ${question.label}`);
  if (question.options?.length) question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
}
function structuralSignatureFromGraph(graph = {}) {
  return JSON.stringify({
    fields: arr(graph.fields).map((field) => [field.id, field.type, field.parentGroupId || '']).sort(),
    groups: arr(graph.groups).map((group) => [group.id, group.groupType, [...arr(group.memberFieldIds)].sort()]).sort((a, b) => a[0].localeCompare(b[0]))
  });
}
function structuralSignatureFromMemory(entry = {}) {
  return JSON.stringify({
    fields: arr(entry.structure?.fields).map((field) => [field.id, field.type, field.groupId || '']).sort(),
    groups: arr(entry.structure?.groups).map((group) => [group.id, group.groupType, [...arr(group.memberFieldIds)].sort()]).sort((a, b) => a[0].localeCompare(b[0]))
  });
}
function knownEntityIsCompatible(entry, graph) {
  return !!entry?.semantic?.semanticName && structuralSignatureFromMemory(entry) === structuralSignatureFromGraph(graph);
}
function workflowContext(memory, session, userAnswers, semanticEntity, currentEntityId) {
  const pathEdges = new Set(session.path || []);
  const traversed = arr(memory.workflow?.edges).filter((edge) => pathEdges.has(edge.id));
  const knownOutgoing = arr(memory.workflow?.edges)
    .filter((edge) => edge.sourceEntityId === currentEntityId)
    .map((edge) => ({ label: edge.label, role: edge.role, targetEntityId: edge.targetEntityId, goalRelevance: edge.goalRelevance, continuity: edge.continuity }));
  return {
    currentEntity: semanticEntity?.semanticName || '',
    traversed: traversed.map((edge) => ({ label: edge.label, role: edge.role, sourceEntityId: edge.sourceEntityId, targetEntityId: edge.targetEntityId })),
    knownOutgoing,
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
    const entityId = before.graph.entity.id;
    console.log(`[LeMap-Web] structural entity: ${before.graph.entity.label}`);

    const known = memory.entities[entityId];
    let local;
    let restored;
    let semanticEntity;

    if (knownEntityIsCompatible(known, before.graph) && process.env.LEMAP_REFRESH_KNOWN !== '1') {
      console.log(`[LeMap-Web] reusing learned semantics: ${known.semantic.semanticName}`);
      local = { restored: true, observations: [], learnedRelationships: arr(known.learnedRelationships), errors: [] };
      restored = before;
      semanticEntity = known.semantic;
    } else {
      local = await exploreLocalEntity(page, { settleMs });
      restored = await capture(page);
      if (!local.restored) throw new Error(`Local exploration did not restore ${entityId}; stopping before user input/navigation.`);
      semanticEntity = await resolveLocalEntity({
        client,
        model,
        entityGraph: restored.graph,
        observations: local.observations,
        learnedRelationships: local.learnedRelationships
      });
      recordEntityKnowledge(memory, {
        structuralEntity: restored.graph.entity,
        structuralGraph: restored.graph,
        semanticEntity,
        learnedRelationships: local.learnedRelationships,
        observations: local.observations
      });
      await saveMemory(memory);
    }

    semanticPath.push(semanticEntity.semanticName || restored.graph.entity.label);
    console.log(`[LeMap-Web] semantic entity: ${semanticEntity.semanticName || '(unnamed)'}`);
    if (semanticEntity.description) console.log(`[LeMap-Web] ${semanticEntity.description}`);

    const answeredQuestionIds = new Set();
    const userAnswers = [];
    while (true) {
      const current = await capture(page);
      const questions = buildUserQuestions({ graph: current.graph, state: current.state, answeredQuestionIds });
      const question = questions[0];
      if (!question) break;

      printQuestion(question);
      const rawAnswer = (await rl.question('Your answer: ')).trim();
      const interpretation = await interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer: rawAnswer });
      const hasAnswer = question.answerKind === 'choice' ? interpretation.selectedFieldIds.length > 0 : interpretation.value !== '';
      if (!hasAnswer || interpretation.confidence < 0.45) {
        console.log(`[LeMap-Web] I could not map that confidently (${interpretation.reason || 'no usable answer'}). Please answer again.`);
        continue;
      }

      await applyQuestionAnswer(page, current.graph, question, interpretation);
      if (settleMs) await page.waitForTimeout(settleMs);
      answeredQuestionIds.add(question.questionId);
      const answerRecord = {
        entityId: current.graph.entity.id,
        questionId: question.questionId,
        groupId: question.groupId || '',
        fieldId: question.fieldId || '',
        question: question.label,
        userAnswer: rawAnswer,
        selectedFieldIds: interpretation.selectedFieldIds,
        value: question.answerKind === 'value' ? interpretation.value : '',
        confidence: interpretation.confidence,
        interpretation: interpretation.reason
      };
      userAnswers.push(answerRecord);
      recordSessionAnswer(memory, session, answerRecord);
      await saveMemory(memory);
      console.log(`[LeMap-Web] interpreted (${interpretation.confidence.toFixed(2)}): ${interpretation.reason || interpretation.selectedFieldIds.join(', ') || interpretation.value}`);
    }

    const completed = await capture(page);
    const candidates = await collectNavigationCandidates(page, completed.graph);
    const context = {
      originalGoal: userGoal,
      semanticPath,
      ...workflowContext(memory, session, userAnswers, semanticEntity, completed.graph.entity.id)
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
