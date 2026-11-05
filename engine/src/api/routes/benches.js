import { z } from 'zod';
import { route } from '../async-route.js';
import { ApiError } from '../../contract/errors.js';
import { EqBench, COMPRESSOR_BENCH_SECONDS } from '../../contract/schemas.js';
import { parse } from '../../session/session-model.js';
import { toDb } from '../../runtime/meter-relay.js';
import {
  compressorBenchCode, eqBenchStartCode, eqBenchSetCode, EQ_BENCH_STOP_CODE, EQ_BENCH_STATE_CODE,
} from '../../sc/commands.js';

/** Cas du banc compresseur, dans l'ordre transmis à sclang : bandes compressées (les autres sont contournées). */
const COMPRESSOR_CASES = [
  { case: 'none', compressed: { low: false, mid: false, high: false } },
  { case: 'low', compressed: { low: true, mid: false, high: false } },
  { case: 'mid', compressed: { low: false, mid: true, high: false } },
  { case: 'high', compressed: { low: false, mid: false, high: true } },
  { case: 'all', compressed: { low: true, mid: true, high: true } },
];

const STOPPED = Object.freeze({ running: false, method: null, parameters: null });
const EmptyBody = z.strictObject({});

const REFUSALS = {
  BENCH_RUNNING: 'Le banc EQ est déjà démarré.',
  BENCH_NOT_RUNNING: 'Le banc EQ n\'est pas démarré.',
};

const unexpected = (what, text) => new ApiError('SC_COMMAND_FAILED', 502, `Réponse inattendue de sclang (${what}) : ${text}`);

/** Réponse de graph.scd : « stopped », « running|méthode|low|mid|high » ou « refused|CODE ». */
function decodeEqBench(text) {
  const parts = String(text).split('|');
  if (parts[0] === 'refused' && REFUSALS[parts[1]]) throw new ApiError(parts[1], 409, REFUSALS[parts[1]]);
  if (parts[0] === 'stopped' && parts.length === 1) return { ...STOPPED };
  if (parts[0] === 'running' && parts.length === 5) {
    const [low, mid, high] = parts.slice(2).map(Number);
    if ([low, mid, high].every(Number.isFinite)) return { running: true, method: parts[1], parameters: { low, mid, high } };
  }
  throw unexpected('banc EQ', text);
}

/** Réponse de graph.scd : « complete|peak,rms|… » ; une cellule vide = cas sans mesure reçue. */
function decodeCompressorBench(text) {
  const [status, ...cells] = String(text).split('|');
  if (!['complete', 'partial'].includes(status) || cells.length !== COMPRESSOR_CASES.length) {
    throw unexpected('banc compresseur', text);
  }
  const cases = COMPRESSOR_CASES.map((c, i) => {
    if (cells[i] === '') return { ...c, peakDb: null, rmsDb: null };
    const [peak, rms] = cells[i].split(',').map(Number);
    return { ...c, peakDb: toDb(peak), rmsDb: toDb(rms) };
  });
  return { status, seconds: COMPRESSOR_BENCH_SECONDS, cases };
}

export function registerBenchRoutes(api, engine) {
  api.post('/benches/compressor/run', route(async (req, res) => {
    parse(EmptyBody, req.body ?? {}, 'Corps');
    const text = await engine.diagnostic(compressorBenchCode(COMPRESSOR_BENCH_SECONDS, COMPRESSOR_CASES));
    res.json(decodeCompressorBench(text));
  }));

  api.get('/benches/eq', route(async (req, res) => {
    if (engine.state().status !== 'running') return res.json({ ...STOPPED });
    return res.json(decodeEqBench(await engine.diagnostic(EQ_BENCH_STATE_CODE)));
  }));

  api.put('/benches/eq', route(async (req, res) => {
    const bench = parse(EqBench, req.body, 'Banc EQ');
    res.json(decodeEqBench(await engine.diagnostic(eqBenchSetCode(bench))));
  }));

  api.post('/benches/eq/start', route(async (req, res) => {
    const bench = parse(EqBench, req.body, 'Banc EQ');
    res.json(decodeEqBench(await engine.diagnostic(eqBenchStartCode(bench))));
  }));

  api.post('/benches/eq/stop', route(async (req, res) => {
    parse(EmptyBody, req.body ?? {}, 'Corps');
    res.json(decodeEqBench(await engine.diagnostic(EQ_BENCH_STOP_CODE)));
  }));
}
