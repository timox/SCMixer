/*
 * Bancs de mesure sur un vrai scsynth.
 *
 * Serveur dédié \mxbench sur 127.0.0.1:57146, sortie MME (jamais ASIO, jamais TimoxVasio), sans
 * entrée matérielle. Vérifie ~mxCompressorBenchRun (cinq cas, compression mesurable, nœuds et bus
 * libérés) et le cycle du banc EQ (démarrage, refus, réglage, changement de méthode, arrêt).
 * Verdict : "MX-TEST-OK" ou "MX-TEST-FAIL <raison>", puis 0.exit.
 */
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var server = Server(\mxbench, NetAddr("127.0.0.1", 57146));
var done = false;
var finish, fail, check, probeBus;

finish = { |line|
  if(done.not) {
    done = true;
    line.postln;
    server.quit;
    SystemClock.sched(1.5, { 0.exit; nil });
  };
};
fail = { |reason| finish.("MX-TEST-FAIL " ++ reason) };
check = { |condition, reason| if(condition.not) { Error(reason).throw } };
// Premier bus privé libre : identique avant et après un banc si tous ses bus ont été rendus à l'allocateur.
probeBus = { var bus = Bus.audio(server, 2), index = bus.index; bus.free; index };

SystemClock.sched(50, { fail.("délai dépassé dans le test sclang"); nil });

server.options.device = "MME : Mappeur de sons Microsoft - Output";
server.options.numInputBusChannels = 0;
server.options.numOutputBusChannels = 4;

~mxSynthDefTimeout = 5;
(root +/+ "sc" +/+ "graph.scd").load;

server.waitForBoot({
  try {
    var result, cells, rms, busTop, synthsBefore, state;
    ("MX-TEST-SCSYNTH-PID " ++ server.pid).postln;
    ~mxInit.(server, 0);
    server.sync;
    busTop = probeBus.value;
    1.wait;
    server.status;
    0.5.wait;
    synthsBefore = server.numSynths;

    // Banc compresseur : cinq cas, ordre de l'API (aucune, grave, médium, aigu, toutes).
    result = ~mxCompressorBenchRun.(1.5, [[1, 1, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0], [0, 0, 0]]);
    cells = result.split($|);
    check.(cells[0] == "complete", "banc compresseur incomplet : " ++ result);
    check.(cells.size == 6, "nombre de cas : " ++ result);
    rms = cells.drop(1).collect { |c| c.split($,)[1].asFloat };
    check.(rms.every { |v| v > 0 }, "mesure nulle : " ++ result);
    check.(rms[4] < (rms[0] * 0.9), "toutes bandes compressées non plus faibles que sans compression : " ++ result);
    check.(rms[1] < rms[0] and: { rms[2] < rms[0] } and: { rms[3] < rms[0] }, "une bande compressée ne réduit pas le niveau : " ++ result);
    server.sync;
    1.wait;
    server.status;
    0.5.wait;
    check.(server.numSynths == synthsBefore, "Synths du banc compresseur non libérés : " ++ server.numSynths ++ " au lieu de " ++ synthsBefore);
    check.(probeBus.value == busTop, "bus du banc compresseur non libérés");

    // Banc EQ.
    check.(~mxEqBenchState.value == "stopped", "état initial");
    check.(~mxEqBenchSet.(\threeBand, 0.5, 0.5, 0.5) == "refused|BENCH_NOT_RUNNING", "réglage sans banc accepté");
    state = ~mxEqBenchStart.(\threeBand, 0.5, 0.25, 0.75);
    check.(state == "running|threeBand|0.5|0.25|0.75", "démarrage : " ++ state);
    check.(~mxEqBenchStart.(\threeBand, 0.5, 0.5, 0.5) == "refused|BENCH_RUNNING", "second démarrage accepté");
    state = ~mxEqBenchSet.(\legacyStack, 0.2, 0.5, 0.9);
    check.(state == "running|legacyStack|0.2|0.5|0.9", "changement de méthode : " ++ state);
    check.(~mxEqBench[\processor].defName == \mx_eqlab_legacy, "SynthDef non remplacée : " ++ ~mxEqBench[\processor].defName);
    state = ~mxEqBenchSet.(\legacyStack, 0.3, 0.5, 0.9);
    check.(state == "running|legacyStack|0.3|0.5|0.9", "réglage : " ++ state);
    check.(~mxEqBenchStop.value == "stopped", "arrêt");
    check.(~mxEqBenchStop.value == "stopped", "arrêt répété");
    server.sync;
    1.wait;
    server.status;
    0.5.wait;
    check.(server.numSynths == synthsBefore, "Synths du banc EQ non libérés : " ++ server.numSynths);
    check.(probeBus.value == busTop, "bus du banc EQ non libérés");

    finish.("MX-TEST-OK");
  } { |error|
    fail.(error.errorString);
  };
}, onFailure: { fail.("démarrage du serveur impossible") });
)
