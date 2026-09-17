export const odooCallPathPriorityProfile = Object.freeze({
  version: 'odoo-structural-priority-v1',
  weights: Object.freeze({
    firstClassEntity: 8,
    crossEntityBoundary: 12,
    persistenceWrite: 10,
    persistenceRead: 4,
    sqlPersistence: 6,
    executableRelation: 2,
    function: 0.25,
    isolatedNoEntityNoPersistence: -12
  })
});
