import { MoquiXmlExecutionAdapter } from '../../moquiXmlExecutionAdapter.js';
import { MoquiEntitySchemaAdapter } from '../../moquiEntitySchemaAdapter.js';

export function createMoquiAdapters(topology) {
  return {
    execution: new MoquiXmlExecutionAdapter(topology),
    entitySchema: new MoquiEntitySchemaAdapter(topology)
  };
}

export { MoquiXmlExecutionAdapter, MoquiEntitySchemaAdapter };
