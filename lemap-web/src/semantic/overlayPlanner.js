import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const SYSTEM = `You are DataSong LeMap-Web's BLOCKING OVERLAY RESOLVER.
A visible modal/dialog is blocking the underlying application. Resolve the overlay before any underlying-page exploration.
You receive the original user goal, the modal text, only the modal's visible actions, and optionally a user's answer to a prerequisite question.
Choose ACT only when a supplied modal action can be taken safely from the evidence. If continuing would assume a user-specific prerequisite, attestation, approval, legal state, payment state, or other fact not known from the application, choose ASK_USER with one concise question. Choose STOP when the overlay cannot be safely resolved.
Never invent actions or user facts. Return strict compact JSON only.`;

export function buildOverlayPrompt({ userGoal = '', overlay = {}, userResponse = '' } = {}) {
  const payload = {
    userGoal,
    overlay: {
      title: overlay.title || '',
      text: overlay.text || '',
      actions: arr(overlay.actions).map((action) => ({ actionId: action.id, label: action.label, disabled: !!action.disabled }))
    },
    userResponse: userResponse ? String(userResponse) : ''
  };
  return `MODE web-overlay-resolution-v1\n${JSON.stringify(payload)}\n\nTASK:\nReturn JSON {decision,actionId,question,confidence,reason}. decision must be act|ask_user|stop. If decision=act, actionId must be one supplied enabled modal action. If decision=ask_user, ask only the minimum missing user-specific fact needed to decide the modal.`;
}

export function normalizeOverlayPlan(raw = {}, actions = []) {
  const allowed = new Set(arr(actions).filter((action) => !action.disabled).map((action) => String(action.id || '')).filter(Boolean));
  const requested = text(raw.actionId, 180);
  let decision = ['act', 'ask_user', 'stop'].includes(raw.decision) ? raw.decision : 'stop';
  if (decision === 'act' && (!requested || !allowed.has(requested))) decision = 'stop';
  const question = decision === 'ask_user' ? text(raw.question, 360) : '';
  if (decision === 'ask_user' && !question) decision = 'stop';
  return {
    decision,
    actionId: decision === 'act' ? requested : '',
    question: decision === 'ask_user' ? question : '',
    confidence: clamp01(raw.confidence),
    reason: text(raw.reason, 420)
  };
}

export async function planOverlayResolution({ client, model, userGoal = '', overlay = {}, userResponse = '' } = {}) {
  const userPrompt = buildOverlayPrompt({ userGoal, overlay, userResponse });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeOverlayPlan(response.parsed, overlay.actions);
}
