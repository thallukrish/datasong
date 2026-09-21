import path from 'node:path';
import { ProgressiveRepositoryTopology } from './progressiveRepositoryTopology.js';

function cleanRepoPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function extensionOf(filePath) {
  return path.posix.extname(filePath).toLowerCase() || '(none)';
}

export class ProgressiveRepositoryTopologyV2 extends ProgressiveRepositoryTopology {
  directoryPreview(dirPath, maxDepth = 3) {
    const normalized = cleanRepoPath(dirPath);
    const prefix = normalized ? `${normalized}/` : '';
    const descendants = this.trackedFiles.filter((file) => file.startsWith(prefix));
    const extensionCounts = {};
    for (const file of descendants) {
      const ext = extensionOf(file);
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    }

    const relativeFiles = descendants.map((file) => file.slice(prefix.length)).filter(Boolean);
    const sampleFiles = relativeFiles.slice().sort().slice(0, 8).map((file) => normalized ? `${normalized}/${file}` : file);

    const topLevelDirs = new Set();
    const directFiles = [];
    for (const relative of relativeFiles) {
      const slash = relative.indexOf('/');
      if (slash >= 0) topLevelDirs.add(relative.slice(0, slash));
      else directFiles.push(relative);
    }

    const shallowTree = this.buildShallowTree(normalized, maxDepth);
    const drillTarget = this.singleChainTarget(normalized, maxDepth);

    return {
      descendantFiles: descendants.length,
      directFiles: directFiles.length,
      directDirectories: topLevelDirs.size,
      extensions: Object.fromEntries(Object.entries(extensionCounts).sort(([a], [b]) => a.localeCompare(b))),
      sampleFiles,
      shallowTree,
      drillTarget
    };
  }

  buildShallowTree(dirPath, maxDepth = 3) {
    const normalized = cleanRepoPath(dirPath);
    const rootPrefix = normalized ? `${normalized}/` : '';
    const root = { path: normalized || '.', directories: new Map(), files: [] };

    for (const tracked of this.trackedFiles) {
      if (!tracked.startsWith(rootPrefix)) continue;
      const relative = tracked.slice(rootPrefix.length);
      if (!relative) continue;
      const parts = relative.split('/');
      let node = root;
      const prefixParts = normalized ? normalized.split('/') : [];
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (i === parts.length - 1) {
          if (prefixParts.length + i - (normalized ? normalized.split('/').length : 0) < maxDepth) node.files.push(part);
          break;
        }
        if (i >= maxDepth) break;
        if (!node.directories.has(part)) {
          const childPath = cleanRepoPath([node.path === '.' ? '' : node.path, part].filter(Boolean).join('/'));
          node.directories.set(part, { path: childPath, directories: new Map(), files: [] });
        }
        node = node.directories.get(part);
      }
    }

    const serialize = (node, depth = 0) => ({
      path: node.path,
      files: node.files.slice().sort().slice(0, 12),
      directories: depth >= maxDepth
        ? []
        : [...node.directories.values()].sort((a, b) => a.path.localeCompare(b.path)).map((child) => serialize(child, depth + 1))
    });
    return serialize(root);
  }

  singleChainTarget(dirPath, maxDepth = 4) {
    let current = cleanRepoPath(dirPath);
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const prefix = current ? `${current}/` : '';
      const dirs = new Set();
      let directFileCount = 0;
      for (const tracked of this.trackedFiles) {
        if (!tracked.startsWith(prefix)) continue;
        const rest = tracked.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf('/');
        if (slash >= 0) dirs.add(rest.slice(0, slash));
        else directFileCount += 1;
      }
      if (directFileCount > 0 || dirs.size !== 1) break;
      current = cleanRepoPath(`${current}/${[...dirs][0]}`);
    }
    return current !== cleanRepoPath(dirPath) ? current : null;
  }

  entryForPath(parent, name, isDirectory) {
    const entry = super.entryForPath(parent, name, isDirectory);
    if (!isDirectory) return entry;
    const preview = this.directoryPreview(entry.path, 3);
    return {
      ...entry,
      preview,
      hint: JSON.stringify({
        kind: 'directory',
        descendantFiles: preview.descendantFiles,
        directFiles: preview.directFiles,
        directDirectories: preview.directDirectories,
        extensions: preview.extensions,
        sampleFiles: preview.sampleFiles,
        drillTarget: preview.drillTarget
      })
    };
  }

  listDirectory(dirPath = '') {
    const observation = super.listDirectory(dirPath);
    const byId = new Map((observation.neighbors || []).map((entry) => [entry.id, entry]));
    observation.canonical = {
      ...observation.canonical,
      entries: (observation.canonical?.entries || []).map((entry) => {
        const full = byId.get(entry.id);
        return full?.kind === 'directory' ? { ...entry, preview: full.preview } : entry;
      }),
      note: 'Directory previews are deterministic structural metadata only. They contain no semantic ranking and no file contents.'
    };
    return observation;
  }
}
