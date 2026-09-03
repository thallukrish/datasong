import crypto from 'node:crypto';

function arr(value) { return Array.isArray(value) ? value : []; }
function sortedUnique(values) { return [...new Set(arr(values))].sort(); }

function hashSeed(seedKey = '') {
  const hex = crypto.createHash('sha1').update(String(seedKey)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function seededRandom(seedKey = '') {
  let state = hashSeed(seedKey) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function chooseBehaviorSamples(options = [], { maxSamples = 10, seedKey = '' } = {}) {
  const domain = arr(options).filter(Boolean);
  const limit = Math.max(1, Number.isFinite(Number(maxSamples)) ? Number(maxSamples) : 10);
  if (domain.length <= limit) {
    return {
      samples: [...domain],
      coverage: {
        domainSize: domain.length,
        probedCount: domain.length,
        exhaustive: true,
        samplingMethod: 'exhaustive'
      }
    };
  }

  const rng = seededRandom(seedKey);
  const indices = domain.map((_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap], indices[index]];
  }
  const chosen = indices.slice(0, limit).sort((a, b) => a - b).map((index) => domain[index]);
  return {
    samples: chosen,
    coverage: {
      domainSize: domain.length,
      probedCount: chosen.length,
      exhaustive: false,
      samplingMethod: 'seeded_random'
    }
  };
}

function filterFieldIds(values, sourceFieldId) {
  return sortedUnique(arr(values).filter((value) => String(value) !== String(sourceFieldId)));
}

function filterOptionMap(map = {}, sourceFieldId) {
  return Object.fromEntries(Object.entries(map || {})
    .filter(([fieldId]) => String(fieldId) !== String(sourceFieldId))
    .sort(([a], [b]) => a.localeCompare(b)));
}

export function normalizeExternalEffect(delta = {}, { sourceFieldId = '' } = {}) {
  return {
    fieldValuesChanged: arr(delta.fieldValuesChanged)
      .filter((change) => String(change?.fieldId) !== String(sourceFieldId))
      .map((change) => ({ fieldId: change.fieldId, before: change.before, after: change.after }))
      .sort((a, b) => String(a.fieldId).localeCompare(String(b.fieldId))),
    fieldsEnabled: filterFieldIds(delta.fieldsEnabled, sourceFieldId),
    fieldsDisabled: filterFieldIds(delta.fieldsDisabled, sourceFieldId),
    fieldsShown: filterFieldIds(delta.fieldsShown, sourceFieldId),
    fieldsHidden: filterFieldIds(delta.fieldsHidden, sourceFieldId),
    fieldsAdded: filterFieldIds(delta.fieldsAdded, sourceFieldId),
    fieldsRemoved: filterFieldIds(delta.fieldsRemoved, sourceFieldId),
    actionsEnabled: sortedUnique(delta.actionsEnabled),
    actionsDisabled: sortedUnique(delta.actionsDisabled),
    actionsShown: sortedUnique(delta.actionsShown),
    actionsHidden: sortedUnique(delta.actionsHidden),
    regionsShown: sortedUnique(delta.regionsShown),
    regionsHidden: sortedUnique(delta.regionsHidden),
    validationMessagesAdded: sortedUnique(delta.validationMessagesAdded),
    validationMessagesRemoved: sortedUnique(delta.validationMessagesRemoved),
    optionsAdded: filterOptionMap(delta.optionsAdded, sourceFieldId),
    optionsRemoved: filterOptionMap(delta.optionsRemoved, sourceFieldId),
    routeChanged: !!delta.routeChanged,
    entityChanged: !!delta.entityChanged
  };
}

function signature(effect = {}) {
  return JSON.stringify(effect);
}

export function clusterBehaviorEffects(probes = [], { coverage = {} } = {}) {
  const grouped = new Map();
  for (const probe of arr(probes)) {
    const effect = probe?.effect || {};
    const key = signature(effect);
    if (!grouped.has(key)) grouped.set(key, { effect, samples: [] });
    grouped.get(key).samples.push(probe.sample);
  }
  const classes = [...grouped.values()].map((group, index) => ({
    id: `behavior-class:${String(index + 1).padStart(2, '0')}`,
    effect: group.effect,
    samples: group.samples,
    sampleCount: group.samples.length,
    wildcard: !!coverage.exhaustive && grouped.size === 1
  }));
  return {
    coverage: { ...coverage },
    classes,
    exhaustiveWildcard: !!coverage.exhaustive && classes.length === 1
  };
}
