// Saved conversations: one JSON file per session in the logs/ folder.

import fs from 'node:fs/promises';
import path from 'node:path';
import { MODERATOR } from '../shared/turns.js';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function isValidSessionId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function summarizeSession(s) {
  const transcript = Array.isArray(s.transcript) ? s.transcript : [];
  return {
    id: s.id,
    title: s.title || 'Untitled parley',
    agenda: s.agenda || '',
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null,
    participants: (s.participants || []).map((p) => p.name),
    turns: transcript.filter((e) => e.speaker !== MODERATOR).length,
    totalTurns: s.totalTurns || null,
    hasRecap: Boolean(s.recap),
  };
}

export class SessionStore {
  constructor(dir) {
    this.dir = dir;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  file(id) {
    if (!isValidSessionId(id)) throw new Error('Invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  async list() {
    let names;
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!isValidSessionId(id)) continue;
      try {
        const session = JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8'));
        out.push(summarizeSession({ ...session, id }));
      } catch {
        // skip unreadable files
      }
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(id) {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(id, session) {
    const data = { ...session, id, updatedAt: new Date().toISOString() };
    if (!data.createdAt) data.createdAt = data.updatedAt;
    const file = this.file(id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file);
    return summarizeSession(data);
  }

  async remove(id) {
    try {
      await fs.unlink(this.file(id));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}
