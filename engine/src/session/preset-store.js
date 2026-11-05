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

  maxOnDisk() {
    if (!fs.existsSync(this.dir)) return 0;
    let max = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^preset-([1-9]d*).json$/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  create(name, session) {
    const fmt = (r) => r.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    const parsed = PresetCreate.safeParse({ name });
    if (!parsed.success) throw fail('VALIDATION', `Preset invalide (${fmt(parsed)})`);
    const content = PresetFile.shape.content.safeParse({ sources: session?.sources, outputs: session?.outputs });
    if (!content.success) throw fail('VALIDATION', `Contenu de preset invalide (${fmt(content)})`);
    if (new Set(content.data.sources.map((s) => s.id)).size !== content.data.sources.length) {
      throw fail('VALIDATION', 'Contenu de preset invalide (identifiants de source en double)');
    }
    validateChannels(content.data.sources);
    const seq = Math.max(this.nextSeq(), this.maxOnDisk() + 1);
    const preset = {
      version: 1,
      id: `preset-${seq}`,
      name: parsed.data.name,
      createdAt: new Date().toISOString(),
      content: structuredClone(content.data),
    };
    if (fs.existsSync(this.fileOf(preset.id))) {
      throw new Error(`Preset déjà existant, écriture refusée : ${this.fileOf(preset.id)}`);
    }
    writeJsonAtomic(this.seqFile, { nextPresetSeq: seq + 1 });
    writeJsonAtomic(this.fileOf(preset.id), preset);
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
