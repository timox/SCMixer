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
    if (json?.version === 1) {
      throw unreadable('session de version 1 (profil audio persisté) ; le contrat est passé à la version 3, le profil audio est désormais lu depuis TimoxVasio. Supprimer ce fichier pour repartir d’une session vide');
    }
    if (json?.version === 2) {
      throw unreadable('session de version 2 (champs de traitement ratio, makeupDb, ceilingDb remplacés par les arguments réels des UGens) ; le contrat est passé à la version 3, sans migration. Supprimer ce fichier pour repartir d’une session vide');
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
