import { CycleSafeExplorer } from './cycleSafeExplorer.js';

export class SemanticFunctionExplorer extends CycleSafeExplorer {
  candidatePriority(candidate) {
    let score = super.candidatePriority(candidate);
    const relation = String(candidate?.relation || '');
    score += ({
      triggers: 90,
      handles: 88,
      on_success: 86,
      on_error: 86,
      delayed_trigger: 82,
      registers: 78,
      configured_by: 70
    }[relation] || 0);
    if (candidate?.kind === 'semantic_function') score += 20;
    return score;
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    return `UNIFORM SEMANTIC-FUNCTION MODEL\nDataSong has normalized source structure into function-like semantic units before this prompt. Treat every observed unit uniformly as a semantic function: ordinary functions/methods/services, module/global execution, UI/event triggers, config/environment/constant value providers, queries and external boundaries.\n\nImportant interpretation rules:\n- $module_init.* is executable global/module scope and may be the beginning of a vertical slice.\n- $event.* is a trigger function; follow triggers/handles edges to its callback handler.\n- $config.*, $env.* and $constant.* are value-returning functions. Their values can explain WHY a branch, policy or behavior occurs, so use configured_by evidence when it materially enriches the flow.\n- Builtin/framework mechanisms are not business nodes; when they register callbacks or continue async control flow their effect is already represented as registers/triggers/on_success/on_error/delayed_trigger edges.\n- Do not ask to inspect files merely because they contain these functions; files are provenance only.\n- A previously visited function is semantically cached by DataSong and will not be offered for traversal again; back-edges/cycles are preserved separately.\n\n${base}`;
  }
}
