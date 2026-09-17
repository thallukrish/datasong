export const odooCallPathPriorityProfile = Object.freeze({
  version: 'odoo-structural-priority-v2',

  // A first-class path node is an executable method owned by an Odoo model.
  // The identity is the model name, so repeated methods on the same model count once.
  firstClassNodes: Object.freeze({
    metadataPath: 'odooExecution',
    flags: Object.freeze(['firstClassEntity', 'firstClassMethod']),
    identityField: 'modelName'
  }),

  // Setup/lifecycle hooks remain available as structural evidence but must not
  // compete with runtime business flows for initial Pass-1 attention.
  excludeWhen: Object.freeze([
    Object.freeze({
      path: 'odooExecution.hookType',
      values: Object.freeze(['pre_init_hook', 'post_init_hook', 'uninstall_hook'])
    })
  ]),
  excludedPriorityScore: -1000000,

  weights: Object.freeze({
    firstClassNode: 100,
    crossEntityBoundary: 20,
    persistenceWrite: 5,
    persistenceRead: 2,
    sqlPersistence: 3,
    executableRelation: 2,
    function: 0.25,
    isolatedNoEntityNoPersistence: -12
  })
});
