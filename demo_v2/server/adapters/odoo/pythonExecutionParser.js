import { extractOdooModels } from './modelParser.js';

export function extractOdooExecution(sourcePath, source, addonName) {
  return { models: extractOdooModels(sourcePath, source, addonName), methods: [] };
}
