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
import { planInformationNeed } from './semantic/informationNeedPlanner.js';
import { setModelCallLogger } from './semantic/modelCall.js';
import { interpretUserAnswer } from './agent/userInput.js';
import { applyQuestionAnswer, chooseExecutableNavigation, executeNavigationCandidate } from './agent/browserActions.js';
import { createSemanticMemory, recordEntityKnowledge, recordSelectedTransition, recordSessionAnswer, startQuerySession } from './agent/memory.js';
import { loadInstanceMemory, recordInstanceFact, saveInstanceMemory } from './agent/instanceMemory.js';
import {
  buildChangeSelectionQuestion,
  buildConfirmationSummary,
  buildInstanceFact,
  buildQuestionFromInteraction,
  classifyInteractionItems,
  interpretationFromRemembered,
  isAffirmativeConfirmation,
  scopeKeyForInteraction
} from './agent/userInteraction.js';
import { createModelClient, modelConfigFromEnv } from './agent/modelClient.js';
import { loadDotEnv } from './agent/env.js';
import { compactModelResult, createRunLogger, summarizeUserInteraction } from './agent/runLogger.js';

const loadedEnvFiles = await loadDotEnv({ cwd: process.cwd(), env: process.env });

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const settleMs = Number.isFinite(Number(process.env.LEMAP_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_SETTLE_MS)) : 500;
const maxSteps = Number.isFinite(Number(process.env.LEMAP_MAX_STEPS)) ? Math.max(1, Number(process.env.LEMAP_MAX_STEPS)) : 20;
const memoryFile = path.resolve(process.env.LEMAP_MEMORY_FILE || path.join('data', 'semantic-memory', 'web-map.json'));
const instanceFile = path.resolve(process.env.LEMAP_INSTANCE_FILE || path.join('data', 'instances', 'default.json'));
const runLogDir = path.resolve(process.env.LEMAP_RUN_LOG_DIR || path.join('data', 'query-runs'));

function arr(value) { return Array.isArray(value) ? value : []; }
function slug(value = '') { return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100); }
function workflowKeyFromGoal(goal = '') {
  const itr = String(goal).match(/\bITR\s*[- ]?\s*([1-7])\b/i);
  return itr ? `itr-${itr[1]}` : slug(goal) || 'workflow';
}
function assessmentYearFromGoal(goal = '') { return String(goal).match(/\b20\d{2}-\d{2}\b/)?.[0] || ''; }
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
  console.log('');
  if (question.information) console.log(`[LeMap-Web] ${question.information}`);
  console.log(`[LeMap-Web] ${question.label}`);
  if (question.examples?.length) console.log(`  Examples: ${question.examples.slice(0, 4).join(' • ')}`);
  if (question.options?.length) question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
}
function applyValueDomains(graph = {}, valueDomains = {}) {
  for (const field of arr(graph.fields)) {
    const values = arr(valueDomains[field.id]);
    if (values.length) field.valueDomain = [...values];
  }
  return graph;
}
function valueDomainsFromMemory(entry = {}) {
  const output = {};
  for (const field of arr(entry.structure?.fields)) {
    if (arr(field.valueDomain).length) output[field.id] = [...field.valueDomain];
  }
  return output;
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
  return !!entry?.semantic?.semanticName
    && Array.isArray(entry.semantic.interactions)
    && structuralSignatureFromMemory(entry) === structuralSignatureFromGraph(graph);
}
function uncoveredUserInputFields(graph = {}, state = {}, semanticEntity = {}) {
  const covered = new Set(arr(semanticEntity.interactions).flatMap((item) => arr(item.structuralFieldIds)).map(String));
  const inputTypes = new Set(['text', 'number', 'date', 'select', 'autocomplete', 'radio', 'checkbox']);
  return arr(graph.fields).filter((field) => inputTypes.has(field.type) && state.fields?.[field.id]?.visible && state.fields?.[field.id]?.enabled && !covered.has(String(field.id)));
}
function workflowContext(memory, session, userAnswers, semanticEntity, currentEntityId, semanticPath) {
  const pathEdges = new Set(session.path || []);
  const traversed = arr(memory.workflow?.edges).filter((edge) => pathEdges.has(edge.id));
  const knownOutgoing = arr(memory.workflow?.edges)
    .filter((edge) => edge.sourceEntityId === currentEntityId)
    .map((edge) => ({ label: edge.label, role: edge.role, targetEntityId: edge.targetEntityId, goalRelevance: edge.goalRelevance, continuity: edge.continuity }));
  return {
    currentEntity: semanticEntity?.semanticName || '',
    semanticPath,
    traversed: traversed.map((edge) => ({ label: edge.label, role: edge.role, sourceEntityId: edge.sourceEntityId, targetEntityId: edge.targetEntityId })),
    knownOutgoing,
    userAnswers
  };
}
function semanticLearningContext(userGoal, semanticPath, userAnswers) {
  return {
    goal: userGoal,
    previousSemanticEntity: semanticPath.at(-1) || '',
    recentSemanticPath: semanticPath.slice(-4),
    recentSelections: userAnswers.slice(-6).map((answer) => {
      if (answer.selectedLabels?.length) return `${answer.question}: ${answer.selectedLabels.join(', ')}`;
      return `${answer.question}: value provided`;
    })
  };
}
async function learnCurrentContext({ page, client, model, memory, settleMs, priorDomains = {}, probeBehavior = true, workflowArc = {} }) {
  const local = await exploreLocalEntity(page, { settleMs, probeBehavior });
  const captured = await capture(page);
  if (!local.restored) throw new Error(`Local exploration did not restore ${captured.graph.entity.id}; stopping before user input/navigation.`);
  const valueDomains = { ...priorDomains, ...local.valueDomains };
  applyValueDomains(captured.graph, valueDomains);
  const previousRelationships = arr(memory.entities?.[captured.graph.entity.id]?.learnedRelationships);
  const semanticEntity = await resolveLocalEntity({
    client,
    model,
    entityGraph: captured.graph,
    observations: local.observations,
    learnedRelationships: [...previousRelationships, ...local.learnedRelationships],
    workflowContext: workflowArc
  });
  recordEntityKnowledge(memory, {
    structuralEntity: captured.graph.entity,
    structuralGraph: captured.graph,
    semanticEntity,
    learnedRelationships: local.learnedRelationships,
    observations: local.observations
  });
  await saveMemory(memory);
  return { local, captured, semanticEntity, valueDomains, mode: 'learn' };
}
async function refreshCurrentContext({ page, client, model, memory, settleMs, priorDomains = {}, workflowArc = {} }) {
  const current = await capture(page);
  const known = memory.entities?.[current.graph.entity.id];
  if (knownEntityIsCompatible(known, current.graph)) {
    const valueDomains = { ...priorDomains, ...valueDomainsFromMemory(known) };
    applyValueDomains(current.graph, valueDomains);
    return { captured: current, semanticEntity: known.semantic, valueDomains, mode: 'reuse' };
  }
  return learnCurrentContext({ page, client, model, memory, settleMs, priorDomains, probeBehavior: true, workflowArc });
}
function modelConsoleLine(summary = {}) {
  const t = summary.tokens || {};
  const total = t.total ?? '?';
  const parts = [];
  if (t.prompt !== null) parts.push(String(t.prompt));
  if (t.completion !== null) parts.push(String(t.completion));
  const split = parts.length === 2 ? ` (${parts.join('+')}${t.cacheHit !== null ? `, cache ${t.cacheHit}` : ''})` : '';
  const result = summary.result || {};
  const outcome = result.decision ? `${result.decision}${result.confidence !== undefined ? ` ${Number(result.confidence).toFixed(2)}` : ''}` : result.semanticName || (result.topScores?.[0]?.candidateId ? `top=${result.topScores[0].candidateId}` : 'ok');
  return `[model] ${summary.purpose}  ${total} tok${split}  ${summary.durationMs}ms  → ${outcome}`;
}
function selectedLabels(question, interpretation) {
  const selected = new Set(arr(interpretation.selectedFieldIds).map(String));
  return arr(question.options).filter((option) => selected.has(String(option.fieldId || ''))).map((option) => option.label).filter(Boolean);
}
function semanticInteractionForQuestion(semanticEntity, question) {
  if (!String(question?.questionId || '').startsWith('interaction:')) return null;
  const semanticKey = String(question.questionId).slice('interaction:'.length);
  return arr(semanticEntity?.interactions).find((item) => item.semanticKey === semanticKey) || null;
}
function scopeKeyForFact(interaction, scopeKeys, workflowKey, fallback = '') {
  return scopeKeyForInteraction(interaction, scopeKeys, workflowKey) || fallback;
}
function printTokenSummary(summary = {}) {
  const purposes = Object.entries(summary.byPurpose || {});
  if (!purposes.length) return;
  console.log('\n[LeMap-Web] model token usage:');
  for (const [purpose, usage] of purposes) console.log(`  ${purpose}: ${usage.calls} calls, ${usage.tokens} tok${usage.cacheHit ? `, cache ${usage.cacheHit}` : ''}`);
  console.log(`  total: ${summary.total.calls} calls, ${summary.total.tokens} tok${summary.total.cacheHit ? `, cache ${summary.total.cacheHit}` : ''}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let browser;
let runLogger = null;
let tokenSummaryWritten = false;
try {
  let userGoal = process.argv.slice(2).join(' ').trim();
  if (!userGoal) userGoal = (await rl.question('What do you want to do? ')).trim();
  if (!userGoal) throw new Error('A user goal is required.');

  runLogger = await createRunLogger({ baseDir: runLogDir, goal: userGoal });
  const config = modelConfigFromEnv();
  const client = createModelClient(config);
  const model = config.model;
  setModelCallLogger(async (event) => {
    if (event.error) {
      console.log(`[model] ${event.purpose}  ${event.durationMs}ms  → ERROR ${event.error}`);
      await runLogger.write('model_error', { purpose: event.purpose, model: event.model, durationMs: event.durationMs, error: String(event.error).slice(0, 400) });
      return;
    }
    const summary = compactModelResult(event);
    console.log(modelConsoleLine(summary));
    await runLogger.recordModel(summary);
  });

  const memory = await loadMemory(userGoal);
  const instanceMemory = await loadInstanceMemory(instanceFile);
  const session = startQuerySession(memory, userGoal);
  await saveMemory(memory);

  const workflowKey = workflowKeyFromGoal(userGoal);
  const scopeKeys = {
    global: 'global',
    taxpayer: process.env.LEMAP_TAXPAYER_SCOPE || '',
    workflow: workflowKey,
    assessment_year: assessmentYearFromGoal(userGoal),
    filing_instance: session.id
  };

  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[LeMap-Web] goal: ${userGoal}`);
  console.log(`[LeMap-Web] attached: ${await page.title()} :: ${page.url()}`);
  if (loadedEnvFiles.length) console.log(`[LeMap-Web] env: ${loadedEnvFiles.join(', ')}`);
  console.log(`[LeMap-Web] semantic memory: ${memoryFile}`);
  console.log(`[LeMap-Web] instance memory: ${instanceFile}`);
  console.log(`[LeMap-Web] run log: ${runLogger.file}`);
  await runLogger.write('attached', { title: await page.title(), route: page.url(), model, workflowKey, instanceMemory: 'loaded' });

  const semanticPath = [];
  for (let step = 1; step <= maxSteps; step += 1) {
    console.log(`\n[LeMap-Web] --- step ${step} ---`);
    const before = await capture(page);
    const entityId = before.graph.entity.id;
    console.log(`[LeMap-Web] structural entity: ${before.graph.entity.label}`);
    await runLogger.write('step', { step, entityId, entityLabel: before.graph.entity.label, route: before.graph.entity.presentation?.route || '' });

    const known = memory.entities[entityId];
    let captured;
    let semanticEntity;
    let valueDomains = {};
    const userAnswers = [];

    if (knownEntityIsCompatible(known, before.graph) && process.env.LEMAP_REFRESH_KNOWN !== '1') {
      console.log(`[LeMap-Web] reusing learned semantics: ${known.semantic.semanticName}`);
      valueDomains = valueDomainsFromMemory(known);
      applyValueDomains(before.graph, valueDomains);
      captured = before;
      semanticEntity = known.semantic;
      await runLogger.write('learn', { mode: 'reuse', entityId, semanticName: semanticEntity.semanticName || '', interactions: arr(semanticEntity.interactions).length });
    } else {
      const learned = await learnCurrentContext({
        page, client, model, memory, settleMs, probeBehavior: true,
        workflowArc: semanticLearningContext(userGoal, semanticPath, userAnswers)
      });
      captured = learned.captured;
      semanticEntity = learned.semanticEntity;
      valueDomains = learned.valueDomains;
      console.log('[LeMap-Web] local learn: full safe widget exploration + option domains + interaction semantics');
      await runLogger.write('learn', {
        mode: 'full_local', entityId: captured.graph.entity.id,
        fields: arr(captured.graph.fields).length, groups: arr(captured.graph.groups).length,
        observations: arr(learned.local?.observations).length,
        relationships: arr(learned.local?.learnedRelationships).length,
        interactions: arr(semanticEntity.interactions).length,
        valueDomains: Object.keys(valueDomains).length
      });
    }

    semanticPath.push(semanticEntity.semanticName || captured.graph.entity.label);
    console.log(`[LeMap-Web] semantic entity: ${semanticEntity.semanticName || '(unnamed)'}`);
    if (semanticEntity.description) console.log(`[LeMap-Web] ${semanticEntity.description}`);
    if (semanticEntity.subEntities?.length) console.log(`[LeMap-Web] semantic sub-entities: ${semanticEntity.subEntities.map((entity) => entity.semanticName).filter(Boolean).join(', ')}`);
    await runLogger.write('semantic_context', {
      entityId: captured.graph.entity.id,
      semanticName: semanticEntity.semanticName || '',
      subEntities: arr(semanticEntity.subEntities).map((entity) => entity.semanticName).filter(Boolean).slice(0, 10),
      interactionKeys: arr(semanticEntity.interactions).map((item) => item.semanticKey).filter(Boolean).slice(0, 12),
      description: String(semanticEntity.description || '').slice(0, 400)
    });

    const answeredQuestionIds = new Set();
    const providedSemanticKeys = new Set();
    const reusedSemanticKeys = new Set();
    const confirmationItems = new Map();
    let forceStop = false;
    let exploreMoreCount = 0;
    let interactionGapRefreshCount = 0;
    let completed;
    let candidates = [];

    while (true) {
      const current = await capture(page);
      applyValueDomains(current.graph, valueDomains);
      const interactionItems = classifyInteractionItems({ graph: current.graph, state: current.state, semanticEntity, instanceMemory, workflowKey, scopeKeys });

      for (const item of interactionItems) {
        if (item.status === 'prefilled' && !providedSemanticKeys.has(item.semanticKey) && !confirmationItems.has(item.semanticKey)) confirmationItems.set(item.semanticKey, item);
      }

      const uncovered = uncoveredUserInputFields(current.graph, current.state, semanticEntity);
      if (uncovered.length) {
        if (interactionGapRefreshCount >= 1) {
          console.log(`[LeMap-Web] semantic interaction coverage incomplete for ${uncovered.length} input field(s); stopping instead of asking raw UI labels.`);
          await runLogger.write('stop', { reason: 'semantic_interaction_coverage_gap', uncoveredFieldCount: uncovered.length });
          forceStop = true;
          break;
        }
        interactionGapRefreshCount += 1;
        console.log(`[LeMap-Web] autonomous exploration for ${uncovered.length} newly exposed input field(s)`);
        await runLogger.write('semantic_interaction_gap', { uncoveredFieldCount: uncovered.length });
        const learned = await learnCurrentContext({
          page, client, model, memory, settleMs, priorDomains: valueDomains, probeBehavior: true,
          workflowArc: semanticLearningContext(userGoal, semanticPath, userAnswers)
        });
        semanticEntity = learned.semanticEntity;
        valueDomains = learned.valueDomains;
        continue;
      }

      const remembered = interactionItems.find((item) => item.status === 'remembered' && !reusedSemanticKeys.has(item.semanticKey));
      if (remembered) {
        const rememberedQuestion = buildQuestionFromInteraction({ graph: current.graph, interaction: remembered });
        const rememberedInterpretation = interpretationFromRemembered({ graph: current.graph, interaction: remembered, fact: remembered.rememberedFact });
        if (rememberedQuestion && rememberedInterpretation) {
          await applyQuestionAnswer(page, current.graph, rememberedQuestion, rememberedInterpretation);
          if (settleMs) await page.waitForTimeout(settleMs);
          reusedSemanticKeys.add(remembered.semanticKey);
          confirmationItems.set(remembered.semanticKey, { ...remembered, status: 'remembered' });
          console.log(`[LeMap-Web] reused remembered value for ${remembered.semanticName || remembered.semanticKey}`);
          await runLogger.write('instance_reuse', { semanticKey: remembered.semanticKey, scope: remembered.valueScope || '', source: 'remembered' });
          exploreMoreCount = 0;
          interactionGapRefreshCount = 0;
          continue;
        }
        reusedSemanticKeys.add(remembered.semanticKey);
        await runLogger.write('instance_reuse_skipped', { semanticKey: remembered.semanticKey, reason: 'stored value no longer maps to current control' });
      }

      const refreshedItems = classifyInteractionItems({ graph: current.graph, state: current.state, semanticEntity, instanceMemory, workflowKey, scopeKeys });
      const candidateQuestions = refreshedItems
        .filter((item) => item.status === 'missing' && !answeredQuestionIds.has(`interaction:${item.semanticKey}`))
        .map((item) => buildQuestionFromInteraction({ graph: current.graph, interaction: item }))
        .filter(Boolean);

      candidates = await collectNavigationCandidates(page, current.graph);
      const context = workflowContext(memory, session, userAnswers, semanticEntity, current.graph.entity.id, semanticPath);
      const informationPlan = await planInformationNeed({ client, model, userGoal, semanticContext: semanticEntity, workflowContext: context, candidateQuestions, navigationCandidates: candidates });

      console.log(`[LeMap-Web] information need: ${informationPlan.decision} (${informationPlan.confidence.toFixed(2)})${informationPlan.reason ? ` :: ${informationPlan.reason}` : ''}`);
      await runLogger.write('planner', {
        decision: informationPlan.decision,
        confidence: informationPlan.confidence,
        questionIds: arr(informationPlan.questionIds),
        candidateQuestionCount: candidateQuestions.length,
        navigationCandidateCount: candidates.length,
        reason: String(informationPlan.reason || '').slice(0, 400)
      });

      if (informationPlan.decision === 'navigate') {
        const summary = buildConfirmationSummary({ semanticEntity, items: [...confirmationItems.values()] });
        if (summary.items.length) {
          console.log(`\n[LeMap-Web] ${summary.intro}`);
          summary.items.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}: ${item.value} (${item.source})`));
          console.log(`[LeMap-Web] ${summary.question}`);
          await runLogger.write('confirmation_request', { items: summary.items.map((item) => ({ semanticKey: item.semanticKey, source: item.source })) });
          const confirmation = (await rl.question('Your answer: ')).trim();
          if (!isAffirmativeConfirmation(confirmation)) {
            const changeQuestion = buildChangeSelectionQuestion(summary);
            printQuestion(changeQuestion);
            const changeAnswer = (await rl.question('Your answer: ')).trim();
            const changeInterpretation = await interpretUserAnswer({ client, model, userGoal, semanticEntity, question: changeQuestion, userAnswer: changeAnswer });
            const semanticKey = changeInterpretation.selectedFieldIds[0];
            const interaction = arr(semanticEntity.interactions).find((item) => item.semanticKey === semanticKey);
            const editQuestion = interaction ? buildQuestionFromInteraction({ graph: current.graph, interaction }) : null;
            if (!interaction || !editQuestion) {
              console.log('[LeMap-Web] I could not identify which prefilled detail to change. Please try again.');
              await runLogger.write('confirmation_change_unresolved', { confidence: changeInterpretation.confidence });
              continue;
            }
            printQuestion(editQuestion);
            const editAnswer = (await rl.question('Your answer: ')).trim();
            const editInterpretation = await interpretUserAnswer({ client, model, userGoal, semanticEntity, question: editQuestion, userAnswer: editAnswer });
            const hasEdit = editQuestion.answerKind === 'choice' ? editInterpretation.selectedFieldIds.length > 0 : editInterpretation.value !== '';
            if (!hasEdit || editInterpretation.confidence < 0.45) {
              console.log('[LeMap-Web] I could not map that change confidently.');
              await runLogger.write('confirmation_change_unresolved', { semanticKey, confidence: editInterpretation.confidence });
              continue;
            }
            await applyQuestionAnswer(page, current.graph, editQuestion, editInterpretation);
            if (settleMs) await page.waitForTimeout(settleMs);
            providedSemanticKeys.add(semanticKey);
            confirmationItems.delete(semanticKey);
            const fact = buildInstanceFact({ interaction, question: editQuestion, interpretation: editInterpretation, workflowKey, scopeKeys, source: 'user' });
            if (fact.scopeKey) {
              recordInstanceFact(instanceMemory, fact);
              if (fact.scope === 'assessment_year') scopeKeys.assessment_year = fact.scopeKey;
              await saveInstanceMemory(instanceFile, instanceMemory);
            }
            await runLogger.write('instance_write', { semanticKey, source: 'user', scope: fact.scope, value: 'stored' });
            exploreMoreCount = 0;
            interactionGapRefreshCount = 0;
            continue;
          }

          for (const item of confirmationItems.values()) {
            const interaction = arr(semanticEntity.interactions).find((candidate) => candidate.semanticKey === item.semanticKey) || item;
            const scopeKey = scopeKeyForFact(interaction, scopeKeys, workflowKey, interaction.valueScope === 'assessment_year' ? item.displayValue : '');
            if (!scopeKey) continue;
            recordInstanceFact(instanceMemory, {
              semanticKey: interaction.semanticKey,
              value: item.currentValue || item.rememberedFact?.value || item.displayValue,
              optionLabel: item.displayValue,
              source: item.status === 'remembered' ? 'remembered' : 'prefill',
              scope: interaction.valueScope || 'filing_instance',
              workflowKey,
              scopeKey,
              confirmed: true
            });
            if (interaction.valueScope === 'assessment_year') scopeKeys.assessment_year = scopeKey;
          }
          await saveInstanceMemory(instanceFile, instanceMemory);
          await runLogger.write('confirmation', { accepted: true, count: summary.items.length, semanticKeys: summary.items.map((item) => item.semanticKey) });
          confirmationItems.clear();
        }
        completed = await capture(page);
        break;
      }

      if (informationPlan.decision === 'stop') {
        console.log('[LeMap-Web] Planner cannot safely advance from current evidence. Stopping with learned memory persisted.');
        await runLogger.write('stop', { reason: 'planner_stop' });
        forceStop = true;
        break;
      }

      if (informationPlan.decision === 'explore_more') {
        if (exploreMoreCount >= 1) {
          console.log('[LeMap-Web] Planner requested additional exploration twice without resolving uncertainty. Stopping to avoid an exploration loop.');
          await runLogger.write('stop', { reason: 'repeated_explore_more' });
          forceStop = true;
          break;
        }
        exploreMoreCount += 1;
        await runLogger.write('explore', { mode: 'behavioral', reason: String(informationPlan.reason || '').slice(0, 300) });
        const learned = await learnCurrentContext({
          page, client, model, memory, settleMs, priorDomains: valueDomains, probeBehavior: true,
          workflowArc: semanticLearningContext(userGoal, semanticPath, userAnswers)
        });
        semanticEntity = learned.semanticEntity;
        valueDomains = learned.valueDomains;
        console.log(`[LeMap-Web] autonomous exploration refreshed semantic context: ${semanticEntity.semanticName || '(unnamed)'}`);
        continue;
      }

      const questionId = informationPlan.questionIds[0];
      const question = candidateQuestions.find((item) => item.questionId === questionId);
      if (!question) {
        console.log(`[LeMap-Web] Planner selected unavailable question ${questionId}. Stopping safely.`);
        await runLogger.write('stop', { reason: 'planner_question_unavailable', questionId });
        forceStop = true;
        break;
      }

      printQuestion(question);
      await runLogger.write('user_question', {
        questionId: question.questionId,
        semanticKey: String(question.questionId || '').startsWith('interaction:') ? String(question.questionId).slice('interaction:'.length) : '',
        question: String(question.label || '').slice(0, 300),
        answerKind: question.answerKind,
        options: arr(question.options).slice(0, 30).map((option) => ({ fieldId: option.fieldId || '', label: option.label }))
      });
      const rawAnswer = (await rl.question('Your answer: ')).trim();
      const interpretation = await interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer: rawAnswer });
      const hasAnswer = question.answerKind === 'choice' ? interpretation.selectedFieldIds.length > 0 : interpretation.value !== '';
      if (!hasAnswer || interpretation.confidence < 0.45) {
        console.log(`[LeMap-Web] I could not map that confidently (${interpretation.reason || 'no usable answer'}). Please answer again.`);
        await runLogger.write('user_answer_unresolved', summarizeUserInteraction({ question, interpretation }));
        continue;
      }

      await applyQuestionAnswer(page, current.graph, question, interpretation);
      if (settleMs) await page.waitForTimeout(settleMs);
      answeredQuestionIds.add(question.questionId);
      const labels = selectedLabels(question, interpretation);
      const interaction = semanticInteractionForQuestion(semanticEntity, question);
      if (interaction) {
        providedSemanticKeys.add(interaction.semanticKey);
        confirmationItems.delete(interaction.semanticKey);
        const fact = buildInstanceFact({ interaction, question, interpretation, workflowKey, scopeKeys, source: 'user' });
        if (fact.scopeKey) {
          recordInstanceFact(instanceMemory, fact);
          if (fact.scope === 'assessment_year') scopeKeys.assessment_year = fact.scopeKey;
          await saveInstanceMemory(instanceFile, instanceMemory);
          await runLogger.write('instance_write', { semanticKey: interaction.semanticKey, source: 'user', scope: fact.scope, value: 'stored' });
        }
      }

      const answerRecord = {
        entityId: current.graph.entity.id,
        questionId: question.questionId,
        question: question.label,
        selectedFieldIds: interpretation.selectedFieldIds,
        selectedLabels: labels,
        valueProvided: question.answerKind === 'value',
        inputType: question.inputType || '',
        confidence: interpretation.confidence,
        interpretation: interpretation.reason
      };
      userAnswers.push(answerRecord);
      recordSessionAnswer(memory, session, { ...answerRecord, selectedLabels: labels, interpretation: question.answerKind === 'value' ? 'value interpreted' : interpretation.reason });
      await saveMemory(memory);
      console.log(`[LeMap-Web] interpreted (${interpretation.confidence.toFixed(2)}): ${question.answerKind === 'value' ? 'value supplied' : interpretation.reason || labels.join(', ')}`);
      const interactionLog = summarizeUserInteraction({ question, interpretation });
      await runLogger.write('user_answer', { ...interactionLog, mode: interpretation.local ? 'local' : 'model' });

      exploreMoreCount = 0;
      interactionGapRefreshCount = 0;
      await runLogger.write('instance_state_change', {
        semanticKey: interaction?.semanticKey || '',
        source: 'user',
        semanticRefresh: false
      });
    }

    if (forceStop) break;
    if (!completed) completed = await capture(page);
    applyValueDomains(completed.graph, valueDomains);
    if (!candidates.length) candidates = await collectNavigationCandidates(page, completed.graph);

    const context = { originalGoal: userGoal, ...workflowContext(memory, session, userAnswers, semanticEntity, completed.graph.entity.id, semanticPath) };
    const scores = await scoreNavigationCandidates({ client, model, userGoal, semanticEntity, workflowContext: context, candidates });

    console.log('\n[LeMap-Web] navigation ranking:');
    for (const score of scores.slice(0, 8)) {
      const candidate = candidates.find((item) => item.id === score.candidateId);
      console.log(`  ${(candidate?.label || score.candidateId)} :: goal=${score.goalRelevance.toFixed(2)} continuity=${score.continuity.toFixed(2)} forward=${score.forwardProgress.toFixed(2)} role=${score.role}`);
    }
    await runLogger.write('navigation_ranking', {
      top: scores.slice(0, 8).map((score) => ({ candidateId: score.candidateId, label: candidates.find((item) => item.id === score.candidateId)?.label || '', goal: score.goalRelevance, continuity: score.continuity, forward: score.forwardProgress, role: score.role }))
    });

    const selected = chooseExecutableNavigation(scores, candidates);
    if (!selected) {
      console.log('[LeMap-Web] No safe goal-directed continuation was selected. Stopping with current semantic memory persisted.');
      await runLogger.write('stop', { reason: 'no_safe_navigation' });
      break;
    }

    const sourceEntityId = completed.graph.entity.id;
    console.log(`[LeMap-Web] navigating via: ${selected.candidate.label} (${selected.score.role})`);
    await runLogger.write('navigation_selected', { sourceEntityId, candidateId: selected.candidate.id, label: selected.candidate.label, role: selected.score.role });
    await executeNavigationCandidate(page, selected.candidate);
    if (settleMs) await page.waitForTimeout(settleMs);
    const target = await capture(page);

    const alternatives = candidates.filter((candidate) => candidate.id !== selected.candidate.id);
    recordSelectedTransition(memory, { sourceEntityId, targetEntityId: target.graph.entity.id, candidate: selected.candidate, score: selected.score, alternatives, session });
    await saveMemory(memory);
    await runLogger.write('transition', { sourceEntityId, targetEntityId: target.graph.entity.id, targetLabel: target.graph.entity.label, route: target.graph.entity.presentation?.route || '' });

    if (target.graph.entity.id === sourceEntityId && target.graph.entity.presentation?.route === completed.graph.entity.presentation?.route) {
      console.log('[LeMap-Web] Selected navigation produced no new entity/route. Stopping to avoid a loop.');
      await runLogger.write('stop', { reason: 'navigation_no_delta' });
      break;
    }
  }

  const tokenSummary = runLogger.tokenSummary();
  printTokenSummary(tokenSummary);
  await runLogger.write('token_summary', tokenSummary);
  tokenSummaryWritten = true;
  await runLogger.write('run_end', { status: 'completed_or_stopped' });
} catch (error) {
  console.error(`[LeMap-Web] query agent failed: ${error.stack || error.message}`);
  await runLogger?.write('error', { message: String(error.message || error).slice(0, 600), stack: String(error.stack || '').split('\n').slice(0, 5).join('\n') });
  if (runLogger && !tokenSummaryWritten) {
    const tokenSummary = runLogger.tokenSummary();
    printTokenSummary(tokenSummary);
    await runLogger.write('token_summary', tokenSummary);
    tokenSummaryWritten = true;
  }
  process.exitCode = 1;
} finally {
  setModelCallLogger(null);
  rl.close();
  if (browser) await browser.close();
}
