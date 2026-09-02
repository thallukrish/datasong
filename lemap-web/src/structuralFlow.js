function arr(value) { return Array.isArray(value) ? value : []; }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return value == null ? '' : String(value); }

function controlFrom(node) {
  return {
    tag: text(node.tag),
    type: text(node.type),
    name: text(node.name),
    value: node.value ?? null,
    label: text(node.label),
    disabled: !!node.disabled,
    hidden: !!node.hidden
  };
}

function collectSemanticChildren(node) {
  const controls = [];
  const regions = [];

  for (const child of arr(node?.children)) {
    if (['input', 'button', 'select', 'textarea'].includes(child?.tag)) {
      controls.push(controlFrom(child));
      continue;
    }

    if (child?.label) {
      regions.push(regionFrom(child));
      continue;
    }

    const nested = collectSemanticChildren(child);
    controls.push(...nested.controls);
    regions.push(...nested.regions);
  }

  return { controls, regions };
}

function regionFrom(node) {
  const { controls, regions } = collectSemanticChildren(node);
  return {
    tag: text(node.tag),
    label: text(node.label),
    hidden: !!node.hidden,
    controls,
    regions
  };
}

export function buildPageStructure(root) {
  const { controls, regions } = collectSemanticChildren(root);
  return {
    tag: text(root?.tag),
    label: text(root?.label),
    hidden: !!root?.hidden,
    controls,
    sections: regions
  };
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function diffState(before, after) {
  const changes = [];
  const beforeValues = obj(before?.values);
  const afterValues = obj(after?.values);
  for (const key of [...new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)])].sort()) {
    if (!sameJson(beforeValues[key], afterValues[key])) {
      changes.push({ kind: 'value', key, before: beforeValues[key] ?? null, after: afterValues[key] ?? null });
    }
  }
  const beforeRegions = obj(before?.regions);
  const afterRegions = obj(after?.regions);
  for (const key of [...new Set([...Object.keys(beforeRegions), ...Object.keys(afterRegions)])].sort()) {
    if (!sameJson(beforeRegions[key], afterRegions[key])) {
      changes.push({ kind: 'region', key, before: beforeRegions[key] ?? null, after: afterRegions[key] ?? null });
    }
  }
  return changes;
}

function executionToken(item) {
  if (item?.kind === 'function') return `function:${text(item.name)}`;
  if (item?.kind === 'network') return `network:${text(item.method || 'GET').toUpperCase()}:${text(item.url)}`;
  if (item?.kind === 'event') return `event:${text(item.name)}`;
  return `${text(item?.kind || 'step')}:${text(item?.name || item?.label || '')}`;
}

export function buildWebFlow(input) {
  const effects = diffState(input.sourceState, input.resultState);
  const tokens = [
    `page:${text(input.sourceState?.page)}`,
    input.sourceRegion ? `section:${text(input.sourceRegion)}` : '',
    input.sourceControl ? `control:${text(input.sourceControl)}` : '',
    `trigger:${text(input.trigger?.kind)}:${text(input.trigger?.value ?? '')}`,
    ...arr(input.execution).map(executionToken),
    ...effects.map((effect) => `effect:${effect.kind}:${effect.key}`),
    `state:${text(input.resultState?.page || input.sourceState?.page)}`
  ].filter(Boolean);

  return {
    id: text(input.id),
    source: {
      page: text(input.sourceState?.page),
      region: text(input.sourceRegion),
      control: text(input.sourceControl)
    },
    trigger: { ...obj(input.trigger) },
    execution: arr(input.execution).map((item) => ({ ...item })),
    effects,
    sourceState: input.sourceState,
    resultState: input.resultState,
    normalizedFlowTokens: tokens
  };
}
