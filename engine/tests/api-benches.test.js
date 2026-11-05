import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers/api-harness.js';

const START = { method: 'threeBand', parameters: { low: 0.5, mid: 0.5, high: 0.5 } };

/** Faux sclang : état du banc EQ tenu comme le ferait graph.scd. */
function eqBenchReply() {
  let state = 'stopped';
  return (code) => {
    let m;
    if ((m = /~mxEqBenchStart\.\(\\(\w+), ([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(code))) {
      if (state !== 'stopped') return 'refused|BENCH_RUNNING';
      state = `running|${m[1]}|${m[2]}|${m[3]}|${m[4]}`;
      return state;
    }
    if ((m = /~mxEqBenchSet\.\(\\(\w+), ([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(code))) {
      if (state === 'stopped') return 'refused|BENCH_NOT_RUNNING';
      state = `running|${m[1]}|${m[2]}|${m[3]}|${m[4]}`;
      return state;
    }
    if (code.includes('~mxEqBenchStop')) { state = 'stopped'; return state; }
    if (code.includes('~mxEqBenchState')) return state;
    if (code.includes('~mxCompressorBenchRun')) return 'complete|0.5,0.25|0.4,0.2|0.4,0.2|0.4,0.2|0.1,0.05';
    return undefined;
  };
}

test('banc EQ : démarrage, réglage, arrêt ; état relu dans sclang', async (t) => {
  const h = await startHarness({ lang: { reply: eqBenchReply() } }); t.after(() => h.close());
  assert.deepEqual((await h.call('GET', '/api/benches/eq')).body, { running: false, method: null, parameters: null });

  const started = await h.call('POST', '/api/benches/eq/start', START);
  assert.equal(started.status, 200);
  assert.deepEqual(started.body, { running: true, ...START });
  assert.match(h.langs[0].commands().at(-1), /~mxEqBenchStart\.\(\\threeBand, 0\.5, 0\.5, 0\.5\)/);

  const again = await h.call('POST', '/api/benches/eq/start', START);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'BENCH_RUNNING');

  const set = await h.call('PUT', '/api/benches/eq', { method: 'legacyStack', parameters: { low: 0.2, mid: 0.5, high: 0.9 } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { running: true, method: 'legacyStack', parameters: { low: 0.2, mid: 0.5, high: 0.9 } });
  assert.deepEqual((await h.call('GET', '/api/benches/eq')).body, set.body);

  const stopped = await h.call('POST', '/api/benches/eq/stop');
  assert.deepEqual(stopped.body, { running: false, method: null, parameters: null });
  const notRunning = await h.call('PUT', '/api/benches/eq', START);
  assert.equal(notRunning.status, 409);
  assert.equal(notRunning.body.error.code, 'BENCH_NOT_RUNNING');
});

test('banc EQ : méthode inconnue, champ en trop, valeur hors plage → 400 sans appel sclang', async (t) => {
  const h = await startHarness({ lang: { reply: eqBenchReply() } }); t.after(() => h.close());
  const before = h.langs[0].commands().length;
  for (const body of [
    { ...START, method: 'other' },
    { ...START, extra: 1 },
    { ...START, parameters: { low: 2, mid: 0.5, high: 0.5 } },
    { method: 'threeBand' },
  ]) {
    const r = await h.call('POST', '/api/benches/eq/start', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'VALIDATION');
  }
  assert.equal(h.langs[0].commands().length, before);
});

test('banc compresseur : cinq cas mesurés, en dBFS', async (t) => {
  const h = await startHarness({ lang: { reply: eqBenchReply() } }); t.after(() => h.close());
  const r = await h.call('POST', '/api/benches/compressor/run');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'complete');
  assert.equal(r.body.seconds, 3);
  assert.deepEqual(r.body.cases.map((c) => c.case), ['none', 'low', 'mid', 'high', 'all']);
  assert.deepEqual(r.body.cases[0].compressed, { low: false, mid: false, high: false });
  assert.deepEqual(r.body.cases[4].compressed, { low: true, mid: true, high: true });
  assert.ok(Math.abs(r.body.cases[0].peakDb - 20 * Math.log10(0.5)) < 1e-9);
  assert.ok(Math.abs(r.body.cases[4].rmsDb - 20 * Math.log10(0.05)) < 1e-9);
  assert.match(h.langs[0].commands().at(-1), /~mxCompressorBenchRun\.\(3, \[\[1, 1, 1\], \[0, 1, 1\], \[1, 0, 1\], \[1, 1, 0\], \[0, 0, 0\]\]\)/);
});

test('banc compresseur : cas sans mesure → partial et valeurs nulles', async (t) => {
  const h = await startHarness({ lang: { reply: (code) => (code.includes('~mxCompressorBenchRun') ? 'partial|0.5,0.25||||' : undefined) } });
  t.after(() => h.close());
  const r = await h.call('POST', '/api/benches/compressor/run');
  assert.equal(r.body.status, 'partial');
  assert.equal(r.body.cases[1].peakDb, null);
  assert.equal(r.body.cases[1].rmsDb, null);
});

test('bancs : moteur arrêté → 409 ENGINE_NOT_RUNNING ; GET du banc EQ répond arrêté', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  assert.equal((await h.call('POST', '/api/benches/compressor/run')).body.error.code, 'ENGINE_NOT_RUNNING');
  assert.equal((await h.call('POST', '/api/benches/eq/start', START)).body.error.code, 'ENGINE_NOT_RUNNING');
  assert.deepEqual((await h.call('GET', '/api/benches/eq')).body, { running: false, method: null, parameters: null });
});
