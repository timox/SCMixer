import fs from 'node:fs';
import path from 'node:path';
import { Source, Output, PresetCreate } from '../contract/schemas.js';
import { ApiError, codes } from '../contract/errors.js';
import { validateChannels } from './session-model.js';
import { writeJsonAtomic } from './atomic-file.js';
import { z } from 'zod';

const fail = (code, message) => new ApiError(code, codes[code], message);
const ID = /^preset-[1-9]\d*$/;

const PresetFile = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(ID),
  name: z.string().min(1).max(60),
  createdAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'date ISO attendue'),
  content: z.strictObject({
    sources: z.array(Source),
    outputs: z.strictObject({ master: Output, cue: Output }),
  }),
});

export class PresetStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'presets');
    this.seqFile = path.join(this.dir, 'sequence.json');
  }

  fileOf(id) {
    return path.join(this.dir, `${id}.json`);
  }

  read(id) {
    if (!ID.test(id) || !fs.existsSync(this.fileOf(id))) throw fail('NOT_FOUND', `Preset inconnu : ${id}.`);
    const file = this.fileOf(id);
    const invalid = (why) => fail('VALIDATION', `Preset invalide : ${file} (${why}).`);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw invalid(e.message);
    }
    const r = PresetFile.safeParse(json);
    if (!r.success) {
      throw invalid(r.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; '));
    }
    const ids = new Set(r.data.content.sources.map((s) => s.id));
    if (ids.size !== r.data.content.sources.length) throw invalid('identifiants de source en double');
    if (r.data.id !== id) throw invalid(`identifiant ${r.data.id} différent du nom de fichier`);
    try {
      validateChannels(r.data.content.sources);
    } catch (e) {
      throw invalid(e.message);
    }
    return r.data;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^(preset-[1-9]\d*)\.json$/.exec(f);
      if (!m) continue;
      try {
        const { id, name, createdAt } = this.read(m[1]);
        out.push({ id, name, createdAt });
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
    return out.sort((a, b) => Number(a.id.slice(7)) - Number(b.id.slice(7)));
  }

  nextSeq() {
    if (!fs.existsSync(this.seqFile)) return 1;
    try {
      const n = JSON.parse(fs.readFileSync(this.seqFile, 'utf8')).nextPresetSeq;
      if (Number.isInteger(n) && n >= 1) return n;
    } catch { /* message ci-dessous */ }
    throw new Error(`Compteur de presets illisible : ${this.seqFile}`);
  }

  create(name, session) {
    const parsed = PresetCreate.safeParse({ name });
    if (!parsed.success) {
      throw fail('VALIDATION', `Preset invalide (${parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ')})`);
    }
    const seq = this.nextSeq();
    const preset = {
      version: 1,
      id: `preset-${seq}`,
      name: parsed.data.name,
      createdAt: new Date().toISOString(),
      content: structuredClone({ sources: session.sources, outputs: session.outputs }),
    };
    writeJsonAtomic(this.fileOf(preset.id), preset);
    writeJsonAtomic(this.seqFile, { nextPresetSeq: seq + 1 });
    return preset;
  }

  get(id) {
    return this.read(id);
  }

  remove(id) {
    if (!ID.test(id) || !fs.existsSync(this.fileOf(id))) throw fail('NOT_FOUND', `Preset inconnu : ${id}.`);
    fs.rmSync(this.fileOf(id));
  }
}
