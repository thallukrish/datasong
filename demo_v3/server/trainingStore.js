import fs from 'node:fs/promises';
import path from 'node:path';

function padEpisode(id) {
  return String(id).padStart(6, '0');
}

export class TrainingStore {
  constructor({ root }) {
    this.root = root;
    this.trainingRoot = path.join(root, 'training');
    this.checkpointRoot = path.join(root, 'checkpoints');
  }

  async ensure() {
    await fs.mkdir(this.trainingRoot, { recursive: true });
    await fs.mkdir(this.checkpointRoot, { recursive: true });
  }

  episodePath(episodeId) {
    return path.join(this.trainingRoot, `episode-${padEpisode(episodeId)}.jsonl`);
  }

  async append(episodeId, event) {
    await this.ensure();
    const record = {
      timestamp: new Date().toISOString(),
      episodeId: Number(episodeId),
      ...event
    };
    await fs.appendFile(this.episodePath(episodeId), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async readEpisode(episodeId) {
    try {
      const raw = await fs.readFile(this.episodePath(episodeId), 'utf8');
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async listEpisodes() {
    await this.ensure();
    const files = await fs.readdir(this.trainingRoot);
    return files
      .map((name) => /^episode-(\d{6})\.jsonl$/.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
  }

  async nextEpisodeId() {
    const episodes = await this.listEpisodes();
    return episodes.length ? episodes.at(-1) + 1 : 1;
  }

  async listCheckpoints() {
    await this.ensure();
    const entries = await fs.readdir(this.checkpointRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }
}
