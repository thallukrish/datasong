import { ensureEntityDirectory } from './entityDirectory.js';
import { graphFromSemanticObjects } from './explorer/mapPersistence.js';
import { graphQueryProjection } from './queryGraphProjection.js';

const arr = (value) => Array.isArray(value) ? value : [];

export async function maintainEntityDirectory({ explorer, queryClient, queryModel, dataRoot, log = () => {} }) {
  if (!queryClient) {
    console.log('[lemap directory] maintenance skipped: reasoning service not configured');
    return null;
  }

  const snapshot = explorer.snapshot();
  const graph = graphFromSemanticObjects(snapshot.semanticObjects || {});
  const entityCount = graph.filter((node) => node.type === 'entity').length;
  if (!entityCount) {
    console.log('[lemap directory] no persisted semantic graph entities found; nothing to cluster');
    return null;
  }

  const projection = graphQueryProjection(graph);
  const arcs = [...projection.workflows, ...arr(projection.navigationArcs)];
  console.log(`[lemap directory] maintaining directory from persisted graph: ${entityCount} entities`);
  return ensureEntityDirectory({
    client:queryClient,
    model:queryModel,
    arcs,
    dataRoot,
    repoUrl:snapshot.repoUrl || '',
    commit:snapshot.commit || '',
    log
  });
}

export function registerQueryApi({ app, explorer, queryClient, queryModel, dataRoot }) {
  // Query execution now lives in query_v4. This module only keeps the entity
  // directory fresh. Directory maintenance must never sit in front of Learn:
  // a user pressing Start should enter explorer.run() immediately so state,
  // console output and the learning run log become visible straight away.
  let maintenancePromise = null;

  const runDirectoryMaintenance = (reason) => {
    if (maintenancePromise) {
      console.log(`[lemap directory] maintenance already running; ${reason} will reuse it`);
      return maintenancePromise;
    }

    console.log(`[lemap directory] maintenance trigger: ${reason}`);
    maintenancePromise = maintainEntityDirectory({ explorer, queryClient, queryModel, dataRoot })
      .catch((error) => {
        console.error(`[lemap directory] maintenance failed: ${error.message || error}`);
        return null;
      })
      .finally(() => { maintenancePromise = null; });
    return maintenancePromise;
  };

  if (!explorer.__lemapDirectoryMaintenanceWrapped) {
    const originalRun = explorer.run.bind(explorer);
    explorer.run = async (...args) => {
      console.log('[lemap learn] entering explorer.run; directory maintenance is non-blocking');
      const state = await originalRun(...args);
      // Refresh the directory after new semantic evidence is persisted, but do
      // not hold the Learn lifecycle open while clustering is refreshed.
      void runDirectoryMaintenance('learning cycle completed');
      return state;
    };
    Object.defineProperty(explorer, '__lemapDirectoryMaintenanceWrapped', { value:true, enumerable:false });
  }

  // Refresh a persisted directory in the background at startup. Learn is never
  // made to wait for this promise.
  queueMicrotask(() => { void runDirectoryMaintenance('startup graph check'); });
}
