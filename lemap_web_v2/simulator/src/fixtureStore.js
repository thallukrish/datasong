import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeReplayFixture,
  validateReplayPage,
  validateReplayTransition
} from './fixtureSchema.js';

export async function loadReplayFixture(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return normalizeReplayFixture(JSON.parse(text));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveReplayFixture(filePath, fixture) {
  const normalized = normalizeReplayFixture(fixture);
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return normalized;
}

export function upsertReplayPage(fixture, page) {
  const canonical = normalizeReplayFixture(fixture);
  const validatedPage = validateReplayPage(page);
  const pages = canonical.pages.filter((entry) => entry.pageId !== validatedPage.pageId);
  pages.push(validatedPage);

  return normalizeReplayFixture({
    version: canonical.version,
    workflowId: canonical.workflowId,
    startPageId: canonical.startPageId,
    pages,
    transitions: canonical.transitions
  });
}

export function upsertReplayTransition(fixture, transition) {
  const canonical = normalizeReplayFixture(fixture);
  const validatedTransition = validateReplayTransition(transition);
  const transitions = canonical.transitions.filter((entry) => !(
    entry.fromPageId === validatedTransition.fromPageId
    && entry.actionEntityId === validatedTransition.actionEntityId
  ));
  transitions.push(validatedTransition);

  return normalizeReplayFixture({
    version: canonical.version,
    workflowId: canonical.workflowId,
    startPageId: canonical.startPageId,
    pages: canonical.pages,
    transitions
  });
}
