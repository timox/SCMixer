import fs from 'node:fs';
import path from 'node:path';
import { Session } from '../contract/schemas.js';
import { emptySession, validateChannels } from './session-model.js';
import { writeJsonAtomic } from './atomic-file.js';

export class SessionStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'session.json');
  }

  load() {
    if (!fs.existsSync(this.file)) return emptySession();
    const unreadable = (why) => new Error(`Session illisible : ${this.file} (${why})`);
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      throw unreadable(e.message);
    }
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw unreadable(`JSON invalide : ${e.message}`);
    }
    const r = Session.safeParse(json);
    if (!r.success) {
      const detail = r.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
      throw unreadable(detail);
    }
    try {
      validateChannels(r.data.sources);
    } catch (e) {
      throw unreadable(e.message);
    }
    return r.data;
  }

  save(session) {
    writeJsonAtomic(this.file, session);
  }
}
